var fs = require('fs');
var path = require('path');
var chalk = require('chalk');
var exit = require('exit');
var createHttpServer = require('./modules/http-server');
var createRewriteMiddleware = require('./modules/http/rewrite');
var createWsServer = require('./modules/ws-server');
var plugin = require('./modules/plugin');
var utils = require('./modules/utils');
var logMsg = utils.logMsg;
var logError = utils.logError;
var files = require('./modules/files');
var command = require('./command');
var buildinPlugins = fs.readdirSync(path.join(__dirname, 'plugins')).reduce(function(plugins, filename){
  var name = path.basename(filename, path.extname(filename));

  plugins[name] = {
    name: name,
    filename: path.join(__dirname, 'plugins', filename)
  };

  return plugins;
}, {});


exports.command = command;

//
// run command in child process
//
exports.fork = function(args, options){
  return require('child_process').fork(__filename, args, options);
};


//
// launched by another module
//
exports.launch = function(config){
  if (this === command)
    launch(config);

  if (this === exports)
    launch(command.normalize(config));
};


//
// launched directly (i.e. node index.js ..)
//
if (process.mainModule === module)
  command.run();


//
// main function
//
function launch(config){
  // settings
  var options = command.norm(config);

  var fsWatcher = options.sync ? require('./modules/watch').setBase(options.base) : {
    // stab fsWatcher
    awaitFile: function(){},
    startWatch: function(){},
    stopWatch: function(){},
    isFileObserve: function(){}
  };
  var httpServer = createHttpServer(options, fsWatcher);
  var rewrite = createRewriteMiddleware(options.rewrite);
  var plugins = [
    buildinPlugins.openFile
  ];

  utils.verbose = options.verbose;
  chalk.enabled = options.color && process.stdout.isTTY;
  files.setBase(options.base);


  // check base path
  if (!fs.existsSync(options.base))
  {
    console.error('Base path `' + options.base + '` not found');
    exit(2);
  }


  // banner
  if (options.verbose)
  {
    console.log('Base path: ' + chalk.green(options.base));
    console.log('Watching for FS: ' + chalk.green(options.sync ? 'YES' : 'NO'));
    console.log('Devtool: ' + (options.dev ? chalk.yellow('development') : chalk.green('build')));

    if (options.editor)
      console.log('Command to open file in editor: ' + chalk.green(options.editor + ' [filename]'));

    if (options.plugins.length)
      console.log('Plugins:\n  ' + options.plugins.map(function(pluginCfg){
        return chalk.green(pluginCfg.name) + ' → ' + chalk.gray(path.relative(process.cwd(), pluginCfg.filename).replace(/\\/g, '/'));
      }).join('\n  '));

    if (rewrite)
      rewrite.banner();

    console.log();
  }

  if (options.index)
    plugins.push(buildinPlugins.fileIndex);

  // init plugins
  plugins.concat(options.plugins).forEach(function(pluginCfg, index, array){
    var isBuildin = options.plugins.indexOf(pluginCfg) === -1;

    if (!isBuildin)
      logMsg('plugin', chalk.yellow(pluginCfg.name) + ' init', true);

    try {
      plugin.init(pluginCfg, options);
    } catch(e) {
      logError('plugin', chalk.yellow(pluginCfg.name) + '\n' + e.stack);
      exit(2);
    }

    if (!isBuildin)
    {
      if (options.verbose)
        logMsg('plugin', chalk.green(pluginCfg.name) + ' inited', true);
      else
        console.log('Plugin', chalk.green(pluginCfg.name), 'inited');

      // blank line after last item list
      if (index == array.length - 1)
        console.log('');
    }
  });


  //
  // files
  //

  files.onAdd(function(filename){
    logMsg('info', files.relativePath(filename) + ' ' + chalk.green('(add)'), true);
  });
  files.onRemove(function(filename){
    var file = files.get(filename);

    logMsg('info', files.relativePath(filename) + ' ' + chalk.red('(drop)'), true);

    fsWatcher.stopWatch(filename);
    if (file.notify)
      fsWatcher.awaitFile(filename);
  });
  files.onRead(function(err, filename, content){
    var file = files.get(filename);

    if (err)
      return logMsg('fs', 'Error: Can\'t read file ' + filename + ': ' + err);

    if (file.content !== content)
    {
      logMsg('info', files.relativePath(filename) + ' ' + chalk.yellow('(update content: ' + content.length + ' bytes)'), true);
      fsWatcher.startWatch(filename);
    }
  });


  //
  // create server
  //

  if (rewrite)
    httpServer.use(rewrite.middleware);

  httpServer.use(require('./modules/http/virtualPath').createMiddleware(httpServer));

  httpServer.listen(options.port, function(){
    var port = this.address().port;

    console.log('Server run at ' + chalk.green('http://localhost:' + port) + '\n');
  });


  //
  // Messaging and fs sync
  //

  if (options.sync)
  {
    var wsServer = createWsServer(httpServer, options);
    require('./modules/file-sync')(wsServer, httpServer, options);
    require('rempl/server')(wsServer, httpServer, options);
  }
}
