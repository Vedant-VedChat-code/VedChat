const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const server = http.createServer((req, res) => {
    let requestPath = decodeURIComponent(
        req.url.split("?")[0]
    );

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    const filePath = path.join(
        PUBLIC_DIR,
        requestPath
    );

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain"
            });

            res.end("VedChat file not found.");
            return;
        }

        const ext = path.extname(filePath);

        const types = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".json": "application/json",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon"
        };

        res.writeHead(200, {
            "Content-Type":
                types[ext] ||
                "application/octet-stream"
        });

        res.end(data);
    });
});

const wss = new WebSocket.Server({
    server: server
});

const rooms = new Map();
const clients = new Map();

function generateCode() {
    const chars =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 10; i++) {
            code += chars[
                crypto.randomInt(0, chars.length)
            ];
        }
    } while (rooms.has(code));

    return code;
}

function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(JSON.stringify(data));
    }
}

function sendToRoom(code, sender, data) {
    const room = rooms.get(code);

    if (!room) {
        return;
    }

    for (const client of room.clients) {
        if (
            client !== sender &&
            client.readyState === WebSocket.OPEN
        ) {
            send(client, data);
        }
    }
}

function removeClient(ws) {
    const info = clients.get(ws);

    if (!info) {
        return;
    }

    const room = rooms.get(info.code);

    if (room) {
        room.clients.delete(ws);

        sendToRoom(
            info.code,
            ws,
            {
                type: "peer-left"
            }
        );

        if (room.clients.size === 0) {
            rooms.delete(info.code);
        }
    }

    clients.delete(ws);
}

wss.on("connection", (ws) => {
    ws.isAlive = true;

    send(ws, {
        type: "server-ready"
    });

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("error", (error) => {
        console.error(
            "WebSocket error:",
            error
        );
    });

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(
                raw.toString()
            );
        } catch (error) {
            send(ws, {
                type: "error",
                message: "Invalid message."
            });

            return;
        }

        /*
         * CREATE ROOM
         */

        if (
            message.type ===
            "create-room"
        ) {
            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "You are already connected."
                });

                return;
            }

            const code =
                generateCode();

            rooms.set(code, {
                clients: new Set([ws])
            });

            clients.set(ws, {
                code: code,
                name:
                    String(
                        message.name ||
                        "User"
                    ).slice(0, 50)
            });

            send(ws, {
                type: "room-created",
                code: code
            });

            return;
        }

        /*
         * JOIN ROOM
         */

        if (
            message.type ===
            "join-room"
        ) {
            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "You are already connected."
                });

                return;
            }

            const code =
                String(
                    message.code || ""
                )
                    .trim()
                    .toUpperCase();

            const room =
                rooms.get(code);

            if (!room) {
                send(ws, {
                    type: "error",
                    message:
                        "Connection code not found."
                });

                return;
            }

            if (room.clients.size >= 2) {
                send(ws, {
                    type: "error",
                    message:
                        "This connection is already full."
                });

                return;
            }

            room.clients.add(ws);

            clients.set(ws, {
                code: code,
                name:
                    String(
                        message.name ||
                        "User"
                    ).slice(0, 50)
            });

            send(ws, {
                type: "room-joined",
                code: code
            });

            sendToRoom(
                code,
                ws,
                {
                    type: "peer-joined",
                    name:
                        String(
                            message.name ||
                            "User"
                        ).slice(0, 50)
                }
            );

            return;
        }

        /*
         * EVERYTHING BELOW REQUIRES A ROOM
         */

        const info =
            clients.get(ws);

        if (!info) {
            send(ws, {
                type: "error",
                message:
                    "Create or join a connection first."
            });

            return;
        }

        /*
         * CHAT
         */

        if (
            message.type === "chat"
        ) {
            const text =
                String(
                    message.text || ""
                ).trim();

            if (!text) {
                return;
            }

            const cleanMessage = {
                type: "chat",
                sender: info.name,
                text: text.slice(0, 5000),
                time:
                    new Date().toISOString()
            };

            sendToRoom(
                info.code,
                ws,
                cleanMessage
            );

            return;
        }

        /*
         * WEBRTC SIGNALING
         */

        const signalTypes = [
            "call-offer",
            "call-answer",
            "ice-candidate",
            "call-decline",
            "call-end"
        ];

        if (
            signalTypes.includes(
                message.type
            )
        ) {
            sendToRoom(
                info.code,
                ws,
                {
                    ...message,
                    sender: info.name
                }
            );

            return;
        }

        /*
         * PING
         */

        if (
            message.type === "ping"
        ) {
            send(ws, {
                type: "pong"
            });

            return;
        }
    });

    ws.on("close", () => {
        removeClient(ws);
    });
});

/*
 * HEARTBEAT
 */

const heartbeat =
    setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }

            ws.isAlive = false;
            ws.ping();
        }
    }, 30000);

wss.on("close", () => {
    clearInterval(heartbeat);
});

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `VedChat server running on port ${PORT}`
        );
    }
);