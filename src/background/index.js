import { Observable } from 'rxjs';
import {
    CONTENT_SCRIPT_CONNECT,
    CONTENT_SCRIPT_DISCONNECT,
    DEVTOOLS_PANEL_CONNECT,
    DEVTOOLS_PANEL_INIT,
} from '../constants/index.js';

const connection = {};
const cacheQueue = [];

const source = Observable.fromEventPattern(
    handler => chrome.runtime.onConnect.addListener(handler),
    handler => chrome.runtime.onConnect.removeListener(handler)
).share();

source
    .filter(port => port.name === DEVTOOLS_PANEL_CONNECT)
    .mergeMap(
        port =>
            Observable.fromEventPattern(
                handler => port.onMessage.addListener(handler),
                handler => port.onMessage.removeListener(handler)
            )
                .takeUntil(
                    Observable.fromEventPattern(handler =>
                        port.onDisconnect.addListener(handler)
                    )
                )
                .finally(() => {
                    const key = Object.keys(connection).find(
                        key => connection[key].devPort === port
                    );
                    delete connection[key].devPort;
                }),
        (port, message) => {
            return { port, message };
        }
    )
    .do(({ port, message }) => {
        if (message.name === DEVTOOLS_PANEL_INIT) {
            if (connection[message.tabId]) {
                connection[message.tabId].devPort = port;
            } else {
                connection[message.tabId] = {
                    devPort: port,
                };
            }
            if (cacheQueue.length > 1) {
                cacheQueue.forEach(item =>
                    connection[message.tabId].devPort.postMessage(item)
                );
                cacheQueue.length = 0;
            }
        }
    })
    .subscribe(() => {
        // hand devtools post message
    });

source
    .filter(port => port.name === CONTENT_SCRIPT_CONNECT)
    .do(port => {
        const id = port.sender.tab.id;
        if (connection[id]) {
            connection[id].contentPort = port;
        } else {
            connection[id] = {
                contentPort: port,
            };
        }
    })
    .mergeMap(
        port =>
            Observable.fromEventPattern(
                handler => port.onMessage.addListener(handler),
                handler => port.onMessage.removeListener(handler)
            )
                .takeUntil(
                    Observable.fromEventPattern(handler =>
                        port.onDisconnect.addListener(handler)
                    )
                )
                .finally(() => {
                    const id = port.sender.tab.id;
                    connection[id].devPort.postMessage({
                        name: CONTENT_SCRIPT_DISCONNECT,
                    });
                    delete connection[id].contentPort;
                }),
        (port, message) => {
            return { port, message };
        }
    )
    .subscribe(({ port, message }) => {
        const id = port.sender.tab.id;
        if (connection[id] && connection[id].devPort) {
            connection[id].devPort.postMessage(message);
        } else {
            cacheQueue.push(message);
        }
    });
