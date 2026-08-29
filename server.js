const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const publicDir = path.join(__dirname, "public");

const mimeTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
    let requestPath = req.url.split("?")[0];

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    const filePath = path.join(
        publicDir,
        path.normalize(requestPath)
    );

    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
    }

    fs.readFile(filePath, (error, data) => {
        if (error) {
            res.writeHead(404, {
                "Content-Type": "text/plain"
            });

            res.end("Not found");
            return;
        }

        const ext = path.extname(filePath);

        res.writeHead(200, {
            "Content-Type":
                mimeTypes[ext] ||
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
    const characters =
        "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let code;

    do {
        code = "";

        for (let i = 0; i < 10; i++) {
            code += characters[
                crypto.randomInt(
                    0,
                    characters.length
                )
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

    if (!room) return;

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

    if (!info) return;

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

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    send(ws, {
        type: "server-ready"
    });

    ws.on("message", (raw) => {

        let message;

        try {
            message = JSON.parse(
                raw.toString()
            );
        } catch {
            send(ws, {
                type: "error",
                message: "Invalid JSON."
            });

            return;
        }

        /*
         CREATE ROOM
        */

        if (message.type === "create-room") {

            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "Already connected to a room."
                });

                return;
            }

            const code = generateCode();

            rooms.set(code, {
                clients: new Set([ws])
            });

            clients.set(ws, {
                code: code,
                name:
                    String(message.name || "User")
                        .slice(0, 50)
            });

            send(ws, {
                type: "room-created",
                code: code
            });

            return;
        }

        /*
         JOIN ROOM
        */

        if (message.type === "join-room") {

            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "Already connected to a room."
                });

                return;
            }

            const code =
                String(message.code || "")
                    .trim()
                    .toUpperCase();

            const room = rooms.get(code);

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
                        "This room already has two users."
                });

                return;
            }

            const name =
                String(message.name || "User")
                    .slice(0, 50);

            room.clients.add(ws);

            clients.set(ws, {
                code: code,
                name: name
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
                    name: name
                }
            );

            return;
        }

        const info = clients.get(ws);

        if (!info) {
            send(ws, {
                type: "error",
                message:
                    "Create or join a connection first."
            });

            return;
        }

        /*
         CHAT
        */

        if (message.type === "chat") {

            const text =
                String(message.text || "")
                    .trim()
                    .slice(0, 5000);

            if (!text) return;

            sendToRoom(
                info.code,
                ws,
                {
                    type: "chat",
                    sender: info.name,
                    text: text,
                    time:
                        new Date().toISOString()
                }
            );

            return;
        }

        /*
         WEBRTC SIGNALING
        */

        const allowedSignals = [
            "offer",
            "answer",
            "ice-candidate",
            "call",
            "call-answer",
            "call-decline",
            "call-end"
        ];

        if (
            allowedSignals.includes(
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
         PING
        */

        if (message.type === "ping") {
            send(ws, {
                type: "pong"
            });
        }
    });

    ws.on("close", () => {
        removeClient(ws);
    });

    ws.on("error", () => {
        removeClient(ws);
    });
});

const heartbeat = setInterval(() => {

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
            `VedChat running on port ${PORT}`
        );
    }
);