var fs = require('fs');
var chalk = require('chalk');
var socket_io = require('socket.io');
var plugin = require('./plugin');
var files = require('./files');
var logMsg = require('./utils').logMsg;
var commands = {};
var socketEvents = [
  'error',
  'connect',
  'disconnect',
  'newListener',
  'removeListener'
];

function assemblyClientApiScript(clientApiScripts, result, fromCache, callback){
  if (!clientApiScripts.length)
    return callback(null, result, fromCache);

  var script = clientApiScripts[0];
  files.readFileIfNeeded(script.filename, function(err, filename, content){
    if (err)
      return callback('(' + filename + '): ' + err);

    result.push({
      filename: files.relativePath(filename),
      content: script.preprocess ? script.preprocess(content) : content
    });

    if (files.get(filename).content !== content)
      fromCache = false;

    assemblyClientApiScript(clientApiScripts.slice(1), result, fromCache, callback);
  });
}

function serveClientApi(httpApi, clientApiScripts){
  var mtime = new Date(Math.max.apply(null, clientApiScripts.map(function(script){
    return fs.statSync(script.filename).mtime;
  })));

  if (httpApi.isContentModified(mtime))
    assemblyClientApiScript(clientApiScripts, [], true, function(err, files, fromCache){
      if (err)
        return httpApi.responseError(500, 'Can\'t read file ' + err);

      // first file is used as is - it's socket.io-client
      // second file is the client source wrapper
      // others are injecting in special place of second one
      var socketIo = files.shift().content;
      var contentWrapper = files.shift().content.replace(/<!--wsendpoint-->/, '//' + httpApi.location.host);
      var content = socketIo + '\n' + files.reduce(function(result, file){
        return result.replace(
          '\n  // <!--inject-->',
          function(m){ // use function to avoid special replacement patterns substitution
            return (
              '\n(function(){\n' +
                file.content +
                '\n//# sourceURL=/' + file.filename +
              '\n})();' +
              '\n' + m
            );
          }
        );
      }, contentWrapper);

      httpApi.responseToClient(content, {
        contentType: 'application/javascript',
        mtime: mtime
      }, fromCache ? chalk.green('(from cache)') : chalk.yellow('(read)'));
    });
}

function addCommand(name, fn){
  if (commands.hasOwnProperty(name))
    throw new Error('WS command `' + name + '` is already in use');

  commands[name] = fn;
}

function getFeatures(socket){
  // EventEmmiter#eventNames implemented since node.js 6.0
  var events = socket.eventNames ? socket.eventNames() : Object.keys(socket._events);
  return events.filter(function(name){
    return socketEvents.indexOf(name) === -1;
  });
}

// extend plugin API
plugin.extendApi(function(api){
  api.addSocketCommand = addCommand;
});

function createWsServer(server, options){
  var wsServer = socket_io(server, { serveClient: false });
  var clientCount = 0;

  wsServer.hasClients = function(){
    return clientCount > 0;
  };

  wsServer.on('connection', function(socket){
    logMsg('socket', 'client ' + chalk.yellow('connected') + ' ' + chalk.gray(socket.id));
    clientCount++;

    for (var name in commands)
      if (commands.hasOwnProperty(name))
        socket.on(name, commands[name]);

    socket
      .on('getAppProfile', require('./ws/getAppProfile')(options))
      .on('getBundle', require('./ws/getBundle')(options))
      .on('disconnect', function(){
        logMsg('socket', 'client ' + chalk.yellow('disconnected') + ' ' + chalk.gray(socket.id));
        clientCount--;
      });

    // socket.on('newListener', ...);
    socket.emit('features', getFeatures(socket));
  });

  return wsServer;
};

module.exports = function(server, options){
  var clientApiScripts = [
    { filename: require.resolve('socket.io-client/dist/socket.io.slim.min.js') },
    { filename: require.resolve('./ws/client.js') }
  ];
  var result = [
    createWsServer(server.http, options)
  ];

  if (server.https)
    result.push(createWsServer(server.https, options));

  // client-side API
  result.addCommand = addCommand;
  result.addClientApi = function(filename, preprocess){
    clientApiScripts.push({
      filename: filename,
      preprocess: preprocess
    });
  };

  result.hasClients = function(){
    return result.some(function(wsServer){
      return wsServer.hasClients();
    });
  };
  result.emit = function(){
    var args = Array.prototype.slice.call(arguments);
    result.forEach(function(wsServer){
      wsServer.emit.apply(wsServer, args);
    });
  };
  result.on = function(){
    var args = Array.prototype.slice.call(arguments);
    result.forEach(function(wsServer){
      wsServer.on.apply(wsServer, args);
    });
  };

  server.addVirtualPath('/basisjs-tools/ws.js', function(httpApi){
    serveClientApi(httpApi, clientApiScripts);
  });

  return result;
};
