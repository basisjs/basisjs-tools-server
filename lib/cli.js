var program = require('./command');

//
// export
//

module.exports = {
  run: program.run.bind(program),
  isCliError: program.isCliError
};
