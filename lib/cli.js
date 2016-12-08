var program = require('./command').extend(require('basisjs-tools-config'));

//
// export
//

module.exports = {
  run: program.run.bind(program),
  isCliError: program.isCliError
};
