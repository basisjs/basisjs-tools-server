var fs = require('fs');
var path = require('path');
var url = require('url');
var net = require('net');
var http = require('http');
var https = require('https');
var createCertificate = require('pem').createCertificate;
var mime = require('mime');
var zlib = require('zlib');
var chalk = require('chalk');
var html = require('basisjs-tools-ast').html;
var logMsg = require('./utils').logMsg;
var logWarn = require('./utils').logWarn;
var logError = require('./utils').logError;
var files = require('./files');
var plugin = require('./plugin');
var virtualPath = require('./http/virtualPath');
var originalReqUrl = new WeakMap();

function onListen(server, options){
  var port = server.address().port;
  var endpoint = 'http://localhost:' + port;

  console.log('Server run at ' +
    chalk.green(endpoint) +
    (options.ssl ? ' and ' + chalk.green('https://localhost:' + port) : '') +
    '\n'
  );

  if (typeof process.send === 'function') {
    process.send({
      event: 'server-started',
      endpoint: endpoint
    });
  }
}

function onError(error, options) {
  console.error(
    chalk.bgRed.white('ERROR') + ' ' +
    (error.code == 'EADDRINUSE' ? 'Port ' + chalk.green(options.port) + ' already in use' : error)
  );
  process.exit(2);
}

function createHttpServer(options, requestHandler){
  return {
    http: http
      .createServer(requestHandler)
      .on('error', function(error){
        onError(error, options);
      })
      .listen(options.port, function(){
        onListen(this, options);
      }),
    https: null
  };
}

// Based on http://stackoverflow.com/a/42019773/685672
function createHttpsServer(options, requestHandler, keys) {
  net
    .createServer(function(socket){
      socket.once('data', function(buffer){
        // Pause the socket
        socket.pause();

        // Determine if this is an HTTP(s) request
        var byte = buffer[0];
        var proxy;

        if (byte === 22)
          proxy = server.https;
        else if (32 < byte && byte < 127)
          proxy = server.http;

        if (proxy)
        {
          // Push the buffer back onto the front of the data stream
          socket.unshift(buffer);

          // Emit the socket to the HTTP(s) server
          proxy.emit('connection', socket);
        }

        // Resume the socket data stream
        socket.resume();
      });
    })
    .on('error', function(error){
      onError(error, options);
    })
    .listen(options.port, function(){
      onListen(this, options);
    });

  var server = {
    http: http.createServer(requestHandler),
    https: https.createServer(keys, requestHandler)
  };

  return server;
}

function isContentModified(req, res, date){
  if (req.headers['if-modified-since'])
  {
    var headerDate = parseInt(new Date(req.headers['if-modified-since']) / 1000);
    var contentDate = parseInt(date / 1000);

    if (isNaN(headerDate))
    {
      logWarn('http', 'Invalid date in If-Modified-Since header');
      headerDate = Infinity; // cheapest way response with no changed
    }

    if (headerDate >= (contentDate || 0))
    {
      responseToClient(req, res, null, {
        status: 304,
        mtime: date
      });
      return false;
    }
  }

  return true;
}

function responseToClient(req, res, content, options, postfix){
  var headers = {};

  for (var header in options.headers)
    headers[header] = options.headers[header];

  if (content && !headers['Content-Type'])
    headers['Content-Type'] = options.contentType || 'application/octet-stream';

  if (options.mtime)
    headers['Last-Modified'] = options.mtime.toGMTString();

  if (options.nocache)
  {
    headers['Cache-Control'] = 'no-cache';
    headers['Pragma'] = 'no-cache';
  }
  else
  {
    if (options.expires)
    {
      headers['Cache-Control'] = 'max-age=' + options.expires;
      headers['Expires'] = (new Date(Number(new Date) + 1000 * options.expires)).toGMTString();
    }
  }

  if (options.encoding && content && content.length > 1024)
  {
    if (options.file && options.file.zip)
    {
      if (options.encoding in options.file.zip === false)
        options.file.zip[options.encoding] = zlib[options.encoding + 'Sync'](content);

      headers['Content-Encoding'] = options.encoding;
      content = options.file.zip[options.encoding];
    }
  }

  logMsg('http', reqTransition(req) + ' ' + chalk.green(options.status || 200) + (postfix ? ' ' + postfix : ''));
  res.writeHead(options.status || 200, headers);
  res.end(content);
}

function responseError(req, res, status, message, logReason){
  status = status || 500;

  logMsg('http', req.url + ' ' + chalk.bgRed.white(status) + (logReason ? ' ' + chalk.gray(logReason) : ''));
  res.writeHead(status);
  res.end(message || 'Internal server error');
}

function redirect(req, res, location, status){
  status = status || 301;

  logMsg('http', req.url + chalk.gray(' → ') + location + ' ' + chalk.green(status));

  res.writeHead(status, {
    Location: location
  });
  res.end();
}

function processHtml(req, filename, data, options){
  var ast = html.parse(String(data), { location: false });

  if (req.rewritten)
    html.injectToHead(ast, {
      type: 'tag',
      name: 'base',
      attribs: {
        href: '//' + req.headers.host + path.dirname(files.relativePath(filename)) + '/'
      }
    }, true);

  if (options.resCache)
  {
    var resourceScript = {
      type: 'tag',
      name: 'script',
      attribs: {
        src: '/basisjs-tools/resourceCache.js'
      },
      children: []
    };

    var firstScript = html.getElementByName(ast.head, 'script') || html.getElementByName(ast, 'script');
    if (firstScript)
      html.insertBefore(firstScript, resourceScript);
    else
      html.injectToHead(ast, resourceScript);
  }

  if (options.sync)
  {
    html.injectToBody(ast, {
      type: 'tag',
      name: 'script',
      attribs: {
        src: '/basisjs-tools/ws.js',
        async: undefined,
        defer: undefined
      },
      children: []
    });

    if (options.inspect)
      html.injectToBody(ast, {
        type: 'tag',
        name: 'script',
        attribs: {
          src: options.inspect,
          async: undefined,
          defer: undefined
        },
        children: []
      });
  }

  return html.translate(ast);
}

function reqTransition(req){
  var original = originalReqUrl.get(req);
  var originalUrl = original.url;
  var currentUrl = req.url;

  if (original.host !== req.headers.host)
  {
    originalUrl = original.host + originalUrl;
    currentUrl = req.headers.host + currentUrl;
  }

  return originalUrl !== currentUrl ? originalUrl + chalk.gray(' → ') + currentUrl : currentUrl;
}

function createServer(options, keys){
  function resolveEncoding(req){
    if (options.gzip)
    {
      var encoding = req.headers['accept-encoding'];

      if (encoding)
        return encoding.toLowerCase().replace(/^.*?\b(gzip|deflate)\b.*$|.*/, '$1');
    }

    return '';
  }

  function resolvePathnameFile(req, res, callback){
    var location = url.parse(req.url, true, true);
    var relFilename = decodeURIComponent(location.pathname);
    var filename = files.absolutePath(relFilename);

    if (relFilename == '/favicon.ico' && !fs.existsSync(filename))
      return callback(__dirname + '/assets/favicon.ico');

    for (var path in symlinks)
      if (relFilename.indexOf(path) === 0 && (relFilename === path || relFilename[path.length] === '/'))
      {
        filename = symlinks[path] + relFilename.substr(path.length);
        logMsg('http', relFilename + ' symlink to ' + filename, true);
        break;
      }

    files.exists(filename, function(error){
      if (error)
      {
        responseError(req, res, 404, 'File ' + filename + ' not found', (error && !options.verbose ? chalk.gray(error) : ''));
        logMsg('', 'full path: ' + filename, true);
        logMsg('', 'reason: ' + chalk.gray(error || 'file not found'), true);

        if (req.headers['x-basis-resource'])
          files.awaitFile(filename);

        return;
      }

      if (fs.statSync(filename).isDirectory())
      {
        // /path -> /path/
        if (!/\/$/.test(relFilename))
          return redirect(req, res, relFilename + '/');

        if (fs.existsSync(filename + '/index.html'))
          return callback(filename + '/index.html');

        if (fs.existsSync(filename + '/index.htm'))
          return callback(filename + '/index.htm');

        return responseError(req, res, 404, 'Path ' + filename + ' is not a file');
      }

      return callback(filename);
    });
  }

  function normalizeFilename(filename){
    return path.resolve('/' + filename)
      // windows issues: cut drive in beginning and replaces `\` to `/`
      .replace(/^[a-z]:/i, '')
      .replace(/\\/g, '/');
  }

  function createPluginApi(api, name){
    api.addSymlink = httpServer.addSymlink;
    api.addMiddleware = httpServer.use;
    api.addVirtualFile = function(filename, content){
      var filename = '/basisjs-tools/plugin:' +
                     path.basename(path.dirname(name).replace(/^\.$/, '') || name) +
                     normalizeFilename(filename);
      var contentType = mime.lookup(filename, 'text/plain');
      var file = {
        content: content,
        zip: {}
      };

      virtualPath.add(filename, function(api){
        api.responseToClient(content, {
          contentType: contentType,
          encoding: api.encoding,
          file: file
        }, chalk.green('(from cache)'));
      });

      return filename;
    };
  }

  function defaultRequestHandler(req, res){
    var reqPathname = url.parse(req.url).pathname;

    resolvePathnameFile(req, res, function(filename){
      var filename = path.normalize(filename);

      req.url = files.relativePath(filename);

      if (!isContentModified(req, res, fs.statSync(filename).mtime))
        return;

      if (!options.readCache)
        files.remove(filename);

      files.readFileIfNeeded(filename, function(err, filename, data){
        if (err)
          return responseError(req, res, 500, 'File read error: ' + err);

        var file = files.get(filename);
        var contentType = mime.lookup(filename, 'text/plain');
        var isTextFile = /^text\/|^application\/(javascript|json|.+\+xml$)/.test(contentType);
        var responseOptions = {
          contentType: contentType + (isTextFile ? '; charset=utf-8' : ''),
          encoding: isTextFile && resolveEncoding(req), // gzip, deflate
          mtime: file.mtime,
          file: file,
          nocache: true
          //expires: contentType == 'text/html' ? 0 : 60 * 60 // 1 hour
        };

        if (options.resCache && req.headers['x-basis-resource'])
        {
          files.startWatch(filename);
          files.addToCache(filename, String(data), reqPathname);
        }

        if (contentType == 'text/html')
          data = processHtml(req, filename, data, options);

        responseToClient(
          req,
          res,
          data,
          responseOptions,
          data !== file.content ? chalk.yellow('(file read)') : chalk.green('(from cache)')
        );
      });
    });
  }

  function processRequest(req, res, middleware){
    logMsg('http', req.url + chalk.gray(' → ') + chalk.yellow(middleware.fn.name || '<anonymous-middleware>'), true);
    middleware.fn(req, res, function next(){
      if (middleware.next)
        processRequest(req, res, middleware.next);
    });
  }

  function requestHandler(req, res){
    originalReqUrl.set(req, {
      host: req.headers.host,
      url: req.url
    });

    processRequest(req, res, requestProcessPipelineHead);
  };

  var symlinks = {};
  var requestProcessPipelineFinal = {
    fn: defaultRequestHandler,
    next: null
  };
  var requestProcessPipelineHead = requestProcessPipelineFinal;
  var requestProcessPipelineTail = null;
  var httpServer = options.ssl
                    ? createHttpsServer(options, requestHandler, keys)
                    : createHttpServer(options, requestHandler);

  httpServer.addSymlink = function(from, to){
    from = path.normalize(from).replace(/\\/g, '/').replace(/\/$/, '');
    to = path.normalize(to).replace(/\\/g, '/').replace(/\/$/, '');
    symlinks[from] = to;
  };
  httpServer.addVirtualPath = function(path, fn){
    if (typeof fn == 'string')
    {
      var filename = fn;
      fn = function(httpApi){
        files.readFileIfNeeded(filename, function(err, filename, content){
          if (err)
            return httpApi.resposeError(500, err);

          httpApi.responseToClient(content, {
            contentType: 'text/html'
          });
        });
      };
    }

    virtualPath.add(path, fn);
  };
  httpServer.resolveEncoding = resolveEncoding;
  httpServer.isContentModified = isContentModified;
  httpServer.responseToClient = responseToClient;
  httpServer.responseError = responseError;
  httpServer.redirect = redirect;
  httpServer.use = function(middleware){
    var listItem = {
      fn: middleware,
      next: requestProcessPipelineFinal
    };

    if (requestProcessPipelineTail)
      requestProcessPipelineTail.next = listItem;
    else
      requestProcessPipelineHead = listItem;

    requestProcessPipelineTail = listItem;
  };
  httpServer.log = function(message, verboseOnly){
    return logMsg('http', message, verboseOnly);
  };
  httpServer.warn = function(message){
    return logWarn('http', message);
  };
  httpServer.error = function(message){
    return logError('http', message);
  };

  plugin.extendApi(createPluginApi);

  return httpServer;
};

function readSslFile(filename, type){
  try {
    if (!filename)
      throw new Error('Path for file is not specified');
    return fs.readFileSync(filename);
  } catch(e) {
    console.error(chalk.bgRed.white('ERROR') + ' Read SSL ' + chalk.yellow(type) + ' file:\n      ' + e.message);
    process.exit(2);
  }
}

module.exports = function(options, next){
  var keys = {
    key: null,
    cert: null
  };

  if (options.ssl && !options.sslKey && !options.sslCert)
  {
    if (options.verbose)
      console.warn('Create a self-signed certificate since --ssl-key and -ssl-cert options are not specified');

    createCertificate({ days: 30, selfSigned: true }, function(err, keys){
      if (err)
      {
        console.error('Error on create a certificate:', err);
        process.exit(2);
      }

      keys.cert = keys.certificate;
      keys.key = keys.serviceKey;
      next(createServer(options, keys), options);
    });
  }
  else
  {
    if (options.ssl)
    {
      keys.key = readSslFile(options.sslKey, '--ssl-key');
      keys.cert = readSslFile(options.sslCert, '--ssl-cert');
    }

    next(createServer(options, keys), options);
  }
};
