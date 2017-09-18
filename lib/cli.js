var clap = require.main.require('clap');
var command = require('./command');

function run(args){
  try {
    command.run(args);
  } catch(e) {
    if (e instanceof clap.Error)
      console.error(e.message || e);
    else
      throw e;

    process.exit(2);
  }
}

//
// export
//

module.exports = {
  run: run,
  server: command
};
