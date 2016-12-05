[![NPM version](https://img.shields.io/npm/v/basisjs-tools-server.svg)](https://www.npmjs.com/package/basisjs-tools-server)
[![Dependency Status](https://img.shields.io/david/basisjs/basisjs-tools-server.svg)](https://david-dm.org/basisjs/basisjs-tools-server)

http/ws development server as part of [basisjs-tools](https://github.com/basisjs/basisjs-tools)

### server

`server` command launch a server instance:

```
> basis server
```

By default current folder becomes server root (you can change it using `--base` option). You also can set listening port with `--port` option on command run or define it in config (useful when launch several servers). By default server listen port `8000`.

```
> basis server -p 8123
Server run at http://localhost:8123
```

Server caches files you access to and inject it into html page (via `window.__resources__`). This approach speeds up page loading with many files.

Also it watches for files changes and send new file content to client if neccessary (using `socket.io` and `basis.js` infrastructure). When you use this server you usually don't need to refresh page when you change `.tmpl`, `.css`, `.json` or `.l10n` files.

## License

MIT License.
