var clap = require.main.require('clap');
var program = require('./command').extend(require('basisjs-tools-config'));

//
// export
//

module.exports = {
  run: program.run.bind(program),
  isCliError: function(err){
    return err instanceof clap.Error;
  }
};
