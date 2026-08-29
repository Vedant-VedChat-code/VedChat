const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const PUBLIC_DIR = path.join(__dirname, "public");
const USERS_FILE = path.join(__dirname, "users.json");

let users = {};

/* =========================================================
   LOAD USERS
========================================================= */

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(
                USERS_FILE,
                "utf8"
            );

            users = JSON.parse(data);

            if (
                typeof users !== "object" ||
                users === null ||
                Array.isArray(users)
            ) {
                users = {};
            }
        }
    } catch (error) {
        console.error("Could not load users:", error);
        users = {};
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(users, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Could not save users:", error);
    }
}

loadUsers();

/* =========================================================
   CONNECTION STORAGE
========================================================= */

const rooms = new Map();
const clients = new Map();

/*
    rooms:
    connectionCode -> {
        clients: Set()
    }

    clients:
    websocket -> {
        code,
        name
    }
*/

/* =========================================================
   10 CHARACTER CODE
========================================================= */

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
    } while (users[code]);

    return code;
}

/* =========================================================
   SEND
========================================================= */

function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error("Send error:", error);
        }
    }
}

/* =========================================================
   SEND TO OTHER USERS IN ROOM
========================================================= */

function sendToPeer(code, sender, data) {
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

/* =========================================================
   CREATE USER
========================================================= */

function createUser(name) {
    const cleanName = String(name || "")
        .trim()
        .slice(0, 50);

    if (!cleanName) {
        return null;
    }

    const code = generateCode();

    users[code] = {
        name: cleanName,
        createdAt: new Date().toISOString()
    };

    saveUsers();

    return {
        code,
        name: cleanName
    };
}

/* =========================================================
   REMOVE CLIENT
========================================================= */

function removeClient(ws) {
    const info = clients.get(ws);

    if (!info) {
        return;
    }

    const room = rooms.get(info.code);

    if (room) {
        room.clients.delete(ws);

        sendToPeer(
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

/* =========================================================
   MIME TYPES
========================================================= */

function getContentType(filePath) {
    const ext = path.extname(filePath)
        .toLowerCase();

    const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon"
    };

    return types[ext] || "application/octet-stream";
}

/* =========================================================
   HTTP SERVER
========================================================= */

const server = http.createServer((req, res) => {
    let requestPath = req.url.split("?")[0];

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    /*
       Prevent paths escaping the public folder.
    */

    const safePath = path.normalize(
        requestPath
    ).replace(/^(\.\.[\/\\])+/, "");

    const filePath = path.join(
        PUBLIC_DIR,
        safePath
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

        res.writeHead(200, {
            "Content-Type":
                getContentType(filePath)
        });

        res.end(data);
    });
});

/* =========================================================
   WEBSOCKET SERVER
========================================================= */

const wss = new WebSocket.Server({
    server
});

/* =========================================================
   WEBSOCKET CONNECTION
========================================================= */

wss.on("connection", (ws) => {
    ws.isAlive = true;

    send(ws, {
        type: "server-ready"
    });

    /* -----------------------------------------------------
       PONG
    ----------------------------------------------------- */

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    /* -----------------------------------------------------
       ERROR
    ----------------------------------------------------- */

    ws.on("error", (error) => {
        console.error(
            "WebSocket error:",
            error
        );
    });

    /* -----------------------------------------------------
       MESSAGE
    ----------------------------------------------------- */

    ws.on("message", (raw) => {
        let message;

        try {
            message = JSON.parse(
                raw.toString()
            );
        } catch (error) {
            send(ws, {
                type: "error",
                message: "Invalid JSON."
            });

            return;
        }

        /* =================================================
           REGISTER
        ================================================= */

        if (message.type === "register") {
            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "You are already connected."
                });

                return;
            }

            const name = String(
                message.name || ""
            )
                .trim()
                .slice(0, 50);

            if (!name) {
                send(ws, {
                    type: "error",
                    message:
                        "Please enter a display name."
                });

                return;
            }

            let code = String(
                message.code || ""
            )
                .trim()
                .toUpperCase();

            /*
               If a valid existing code is supplied,
               restore that user's profile.
            */

            if (code && users[code]) {
                users[code].name = name;
                saveUsers();
            } else {
                /*
                   Otherwise create exactly one
                   new 10-character code.
                */

                const created = createUser(name);

                if (!created) {
                    send(ws, {
                        type: "error",
                        message:
                            "Could not create your account."
                    });

                    return;
                }

                code = created.code;
            }

            let room = rooms.get(code);

            if (!room) {
                room = {
                    clients: new Set()
                };

                rooms.set(code, room);
            }

            /*
               Maximum 2 active users.
            */

            if (room.clients.size >= 2) {
                send(ws, {
                    type: "error",
                    message:
                        "This connection is currently in use."
                });

                return;
            }

            room.clients.add(ws);

            clients.set(ws, {
                code,
                name
            });

            send(ws, {
                type: "registered",
                code,
                name
            });

            sendToPeer(
                code,
                ws,
                {
                    type: "peer-joined",
                    name
                }
            );

            return;
        }

        /* =================================================
           CONNECT TO SOMEONE
        ================================================= */

        if (message.type === "connect") {
            if (clients.has(ws)) {
                send(ws, {
                    type: "error",
                    message:
                        "You are already connected."
                });

                return;
            }

            const code = String(
                message.code || ""
            )
                .trim()
                .toUpperCase();

            const name = String(
                message.name || "User"
            )
                .trim()
                .slice(0, 50);

            if (code.length !== 10) {
                send(ws, {
                    type: "error",
                    message:
                        "Connection code must be 10 characters."
                });

                return;
            }

            if (!users[code]) {
                send(ws, {
                    type: "error",
                    message:
                        "Connection code not found."
                });

                return;
            }

            let room = rooms.get(code);

            if (!room) {
                room = {
                    clients: new Set()
                };

                rooms.set(code, room);
            }

            if (room.clients.size >= 2) {
                send(ws, {
                    type: "error",
                    message:
                        "This connection is currently full."
                });

                return;
            }

            room.clients.add(ws);

            clients.set(ws, {
                code,
                name
            });

            send(ws, {
                type: "connected",
                code,
                name: users[code].name
            });

            sendToPeer(
                code,
                ws,
                {
                    type: "peer-joined",
                    name
                }
            );

            return;
        }

        /* =================================================
           EVERYTHING BELOW REQUIRES CONNECTION
        ================================================= */

        const info = clients.get(ws);

        if (!info) {
            send(ws, {
                type: "error",
                message:
                    "Register or connect first."
            });

            return;
        }

        /* =================================================
           CHAT
        ================================================= */

        if (message.type === "chat") {
            const text = String(
                message.text || ""
            ).slice(0, 5000);

            if (!text.trim()) {
                return;
            }

            sendToPeer(
                info.code,
                ws,
                {
                    type: "chat",
                    sender: info.name,
                    text,
                    time: new Date().toISOString()
                }
            );

            return;
        }

        /* =================================================
           WEBRTC SIGNALING
        ================================================= */

        const signalingTypes = [
            "call",
            "call-answer",
            "offer",
            "answer",
            "ice-candidate",
            "call-decline",
            "call-end"
        ];

        if (
            signalingTypes.includes(
                message.type
            )
        ) {
            sendToPeer(
                info.code,
                ws,
                {
                    ...message,
                    sender: info.name
                }
            );

            return;
        }

        /* =================================================
           PROFILE
        ================================================= */

        if (message.type === "profile") {
            send(ws, {
                type: "profile",
                code: info.code,
                name: info.name
            });

            return;
        }

        /* =================================================
           PING
        ================================================= */

        if (message.type === "ping") {
            send(ws, {
                type: "pong"
            });

            return;
        }

        /* =================================================
           UNKNOWN
        ================================================= */

        send(ws, {
            type: "error",
            message:
                "Unknown message type."
        });
    });

    /* -----------------------------------------------------
       CLOSE
    ----------------------------------------------------- */

    ws.on("close", () => {
        removeClient(ws);
    });
});

/* =========================================================
   HEARTBEAT
========================================================= */

const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (ws.isAlive === false) {
            ws.terminate();
            continue;
        }

        ws.isAlive = false;

        try {
            ws.ping();
        } catch (error) {
            console.error(error);
        }
    }
}, 30000);

wss.on("close", () => {
    clearInterval(heartbeat);
});

/* =========================================================
   START
========================================================= */

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `VedChat server running on port ${PORT}`
        );

        console.log(
            `Users: ${Object.keys(users).length}`
        );
    }
);