#!/usr/bin/env node
// fnOS unified-gateway bridge for SillyTavern.
//
// fnOS forwards /app/<appname>/* requests to the Unix socket this process
// listens on. SillyTavern's frontend calls absolute fetch() URLs and cannot
// run unmodified under a sub-path, so the proxy:
//   1. strips the gateway prefix from requests before forwarding upstream;
//   2. rewrites <base href>, absolute src/href/action attributes in HTML and
//      url() references in CSS back under the gateway prefix;
//   3. injects a shim that rewrites fetch()/XHR/EventSource absolute paths
//      client-side before they leave the page;
//   4. rewrites upstream Location headers, and passes streaming responses
//      (SSE) and WebSocket upgrades through unbuffered.
//
// Required environment: GATEWAY_SOCKET, UPSTREAM_PORT.
// Optional environment: GATEWAY_PREFIX (default /app/fn-sillytavern),
// UPSTREAM_HOST (default 127.0.0.1).

import http from 'node:http';
import fs from 'node:fs';

const GATEWAY_SOCKET = process.env.GATEWAY_SOCKET;
const GATEWAY_PREFIX = process.env.GATEWAY_PREFIX || '/app/fn-sillytavern';
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = Number(process.env.UPSTREAM_PORT || 0);
const LOG_TAG = '[gateway-proxy]';

function log(message) {
    console.log(`${new Date().toISOString()} ${LOG_TAG} ${message}`);
}

if (!GATEWAY_SOCKET || !UPSTREAM_PORT) {
    log('ERROR: GATEWAY_SOCKET and UPSTREAM_PORT are required');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Client-side shim: prefixed before page scripts run, so every absolute
// fetch()/XHR/EventSource URL stays inside the gateway path.
// ---------------------------------------------------------------------------
const SHIM_SOURCE = `(function(){
  var P=${JSON.stringify(GATEWAY_PREFIX)};
  function fixUrl(u){
    if(typeof u==='string'){
      return (u.charAt(0)==='/'&&u!==P&&u.indexOf(P+'/')!==0)?P+u:u;
    }
    if(u instanceof URL){
      if(u.origin===location.origin&&u.pathname.charAt(0)==='/'&&u.pathname!==P&&u.pathname.indexOf(P+'/')!==0){
        return new URL(P+u.pathname+u.search+u.hash,location.origin);
      }
    }
    return u;
  }
  if(window.fetch){
    var of=window.fetch;
    window.fetch=function(input,init){
      try{
        if(typeof Request!=='undefined'&&input instanceof Request){
          var u=new URL(input.url);
          if(u.origin===location.origin&&u.pathname!==P&&u.pathname.indexOf(P+'/')!==0){
            input=new Request(P+u.pathname+u.search,input);
          }
        }else{
          input=fixUrl(input);
        }
      }catch(e){}
      return of.call(window,input,init);
    };
  }
  if(window.XMLHttpRequest){
    var oo=XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open=function(){
      try{ if(arguments.length>1){arguments[1]=fixUrl(arguments[1]);} }catch(e){}
      return oo.apply(this,arguments);
    };
  }
  if(window.EventSource){
    var OE=window.EventSource;
    function Wrapped(u,c){ return Reflect.construct(OE,[fixUrl(u),c],Wrapped); }
    Wrapped.prototype=OE.prototype;
    window.EventSource=Wrapped;
  }
})();`;

const SHIM_SCRIPT = `<script>${SHIM_SOURCE}</script>`;
const BASE_TAG = `<base href="${GATEWAY_PREFIX}/">`;

function addPrefix(pathAndQuery) {
    if (pathAndQuery === GATEWAY_PREFIX || pathAndQuery.startsWith(`${GATEWAY_PREFIX}/`)) return pathAndQuery;
    if (pathAndQuery.startsWith('/')) return GATEWAY_PREFIX + pathAndQuery;
    return pathAndQuery;
}

function stripPrefix(url) {
    const queryIndex = url.indexOf('?');
    let pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
    const search = queryIndex === -1 ? '' : url.slice(queryIndex);
    if (pathname === GATEWAY_PREFIX) pathname = '/';
    else if (pathname.startsWith(`${GATEWAY_PREFIX}/`)) pathname = pathname.slice(GATEWAY_PREFIX.length);
    return pathname + search;
}

function rewriteHtml(body) {
    let html = body.toString('utf8');
    html = html.replace(/(\b(?:src|href|action)=["'])(\/(?!\/)[^"']*)/gi,
        (match, attribute, path) => attribute + addPrefix(path));
    if (/<base\b[^>]*>/i.test(html)) {
        html = html.replace(/<base\b[^>]*>/i, BASE_TAG);
    } else if (/<head\b[^>]*>/i.test(html)) {
        html = html.replace(/<head\b[^>]*>/i, (head) => head + BASE_TAG);
    } else {
        html = BASE_TAG + html;
    }
    html = html.replace(/<base\b[^>]*>/i, (base) => base + SHIM_SCRIPT);
    return html;
}

function rewriteCss(body) {
    const css = body.toString('utf8');
    return css.replace(/url\(\s*(["']?)(\/(?!\/)[^)"']+)\1\s*\)/gi,
        (match, quote, path) => `url(${quote}${addPrefix(path)}${quote})`);
}

function forward(req, res) {
    const headers = { ...req.headers };
    delete headers['accept-encoding']; // need plain text to rewrite HTML/CSS
    headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;

    const upstreamReq = http.request({
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: stripPrefix(req.url || '/'),
        method: req.method,
        headers,
    }, (upstreamRes) => {
        const contentType = String(upstreamRes.headers['content-type'] || '');

        if (upstreamRes.headers.location && upstreamRes.headers.location.startsWith('/')) {
            upstreamRes.headers.location = addPrefix(upstreamRes.headers.location);
        }

        const isRewritable = req.method === 'GET'
            && (contentType.includes('text/html') || contentType.includes('text/css'));
        if (!isRewritable) {
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            upstreamRes.pipe(res); // streaming/SSE passthrough, never buffered
            return;
        }

        const chunks = [];
        upstreamRes.on('data', (chunk) => chunks.push(chunk));
        upstreamRes.on('end', () => {
            const body = Buffer.concat(chunks);
            const text = contentType.includes('text/html') ? rewriteHtml(body) : rewriteCss(body);
            delete upstreamRes.headers['content-length'];
            delete upstreamRes.headers['content-encoding'];
            res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
            res.end(text);
        });
    });

    upstreamReq.on('error', (err) => {
        log(`upstream error: ${err.message}`);
        if (!res.headersSent) {
            res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
        }
        res.end('SillyTavern is starting or unavailable. Please refresh in a moment.');
    });

    req.pipe(upstreamReq);
}

function forwardUpgrade(req, socket, head) {
    const headers = { ...req.headers };
    headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;

    const upstreamReq = http.request({
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: stripPrefix(req.url || '/'),
        method: req.method,
        headers,
    });

    upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
        const lines = ['HTTP/1.1 101 Switching Protocols'];
        for (const [key, value] of Object.entries(upstreamRes.headers)) {
            lines.push(`${key}: ${value}`);
        }
        socket.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);

        socket.on('error', () => upstreamSocket.destroy());
        upstreamSocket.on('error', () => socket.destroy());
    });

    upstreamReq.on('response', (upstreamRes) => {
        socket.write(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || ''}\r\n\r\n`);
        socket.destroy();
    });

    upstreamReq.on('error', () => socket.destroy());
    upstreamReq.end(head);
}

const server = http.createServer(forward);
server.on('upgrade', forwardUpgrade);

server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

try {
    fs.rmSync(GATEWAY_SOCKET, { force: true });
} catch {
    // ignore stale socket cleanup failures
}

server.listen(GATEWAY_SOCKET, () => {
    log(`listening on ${GATEWAY_SOCKET}, forwarding ${GATEWAY_PREFIX} to ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});

function shutdown() {
    log('shutting down');
    server.close(() => {
        try {
            fs.rmSync(GATEWAY_SOCKET, { force: true });
        } catch {
            // ignore
        }
        process.exit(0);
    });
    // Hard exit if connections refuse to drain.
    setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
