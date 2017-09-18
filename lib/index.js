var cli = require('./cli');

exports.cli = cli;
exports.command = cli.server;

// launched by another module
exports.launch = function(config){
  if (this === cli.server)
    require('./launch')(config);

  if (this === exports)
    require('./launch')(cli.server.normalize(config));
};

// run command in child process
exports.fork = function(args, options){
  return require('child_process').fork(__filename, args, options);
};


// launched directly (i.e. node index.js ..)
if (process.mainModule === module)
  cli.server.run();
