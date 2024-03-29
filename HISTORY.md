## 1.0.2 (August 1, 2021)

- Bumped `basisjs-tools-ast` to `1.6.2` to fix HTML serialization

## 1.0.1 (September 18, 2017)

- Improved main module to make its import chepear when external module imports CLI command only
- Fixed basisjs devpanel exception by updating `rempl` to `1.0.0-alpha15` (@istrel, #2)

## 1.0.0 (September 6, 2017)

- Extracted to separate repo/module from [basisjs-tools](https://github.com/basisjs/basisjs-tools)
- Changes since being a part of `basisjs-tools`
    - Changed to use [rempl](https://github.com/rempl/rempl) as backend for devtools
    - Used slim version of `socket.io-client`
    - Added `fork()` method
    - Added notification message for parent process when server is started
    - Added SSL support. Https listen on the same port as http and enables by `--ssl` option. SSL certificate can be specified by `--ssl-cert` and `--ssl-key` options (certificate will be generated automatically when options are not used).
    - Fixed issue when requested file has escaped chars (use `decodeURIComponent` for `pathname`)
    - Fixed value for `href` attribute of `<base>` when url is rewritten
    - Removed `--inspect` option
    - Minor fixes and imrovements

> Warning! For now `/basisjs-tools/devpanel` doesn't work for `basis.js` (1.11.0 at the moment), since basis's devpanel should migrate to rempl.
