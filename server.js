const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const PUBLIC_DIR = path.join(__dirname, "public");
const USERS_FILE = path.join(__dirname, "users.json");

let users = {};
const rooms = new Map();
const clients = new Map();

/* =====================================================
   USERS
===================================================== */

function loadUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = fs.readFileSync(
                USERS_FILE,
                "utf8"
            );

            users = JSON.parse(data);

            if (
                !users ||
                typeof users !== "object" ||
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

/* =====================================================
   CONNECTION CODE
===================================================== */

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

/* =====================================================
   ROOMS
===================================================== */

function getRoom(code) {
    if (!rooms.has(code)) {
        rooms.set(code, {
            clients: new Set()
        });
    }

    return rooms.get(code);
}

/* =====================================================
   WEBSOCKET SEND
===================================================== */

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

/* =====================================================
   USER CREATION
===================================================== */

function createUser(name) {
    const cleanName = String(name || "")
        .trim()
        .slice(0, 40);

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

/* =====================================================
   REMOVE CLIENT
===================================================== */

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

/* =====================================================
   HTTP SERVER
===================================================== */

const server = http.createServer((req, res) => {
    let requestPath = req.url.split("?")[0];

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    /*
     * Basic path protection.
     */
    const safePath = path.normalize(
        requestPath
    ).replace(/^(\.\.[/\\])+/, "");

    const filePath = path.join(
        PUBLIC_DIR,
        safePath
    );

    /*
     * Health check.
     */
    if (requestPath === "/health") {
        res.writeHead(200, {
            "Content-Type": "text/plain"
        });

        res.end("VedChat OK");
        return;
    }

    /*
     * Don't expose files outside public.
     */
    if (
        !filePath.startsWith(
            PUBLIC_DIR + path.sep
        )
    ) {
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

        const ext =
            path.extname(filePath).toLowerCase();

        const contentTypes = {
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

        res.writeHead(200, {
            "Content-Type":
                contentTypes[ext] ||
                "application/octet-stream"
        });

        res.end(data);
    });
});

/* =====================================================
   WEBSOCKET SERVER
===================================================== */

const wss = new WebSocket.Server({
    server
});

/* =====================================================
   WEBSOCKET CONNECTION
===================================================== */

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
        } catch {
            send(ws, {
                type: "error",
                message: "Invalid JSON."
            });

            return;
        }

        /* =============================================
           REGISTER
        ============================================= */

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
                .slice(0, 40);

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
             * Existing permanent code.
             */
            if (
                code &&
                users[code]
            ) {
                users[code].name = name;
                saveUsers();
            } else {
                const created =
                    createUser(name);

                code = created.code;
            }

            const room = getRoom(code);

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

        /* =============================================
           CONNECT USING CODE
        ============================================= */

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
                .slice(0, 40);

            if (!users[code]) {
                send(ws, {
                    type: "error",
                    message:
                        "Connection code not found."
                });

                return;
            }

            const room = getRoom(code);

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

        /* =============================================
           REQUIRE CONNECTION
        ============================================= */

        const info = clients.get(ws);

        if (!info) {
            send(ws, {
                type: "error",
                message:
                    "Register or connect first."
            });

            return;
        }

        /* =============================================
           CHAT
        ============================================= */

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
                    time:
                        new Date().toISOString()
                }
            );

            return;
        }

        /* =============================================
           WEBRTC SIGNALING
        ============================================= */

        const signalTypes = [
            "call",
            "offer",
            "answer",
            "ice-candidate",
            "call-answer",
            "call-decline",
            "call-end"
        ];

        if (
            signalTypes.includes(
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

        /* =============================================
           PROFILE
        ============================================= */

        if (message.type === "profile") {
            send(ws, {
                type: "profile",
                code: info.code,
                name: info.name
            });

            return;
        }

        /* =============================================
           PING
        ============================================= */

        if (message.type === "ping") {
            send(ws, {
                type: "pong"
            });

            return;
        }

        send(ws, {
            type: "error",
            message: "Unknown message type."
        });
    });

    ws.on("close", () => {
        removeClient(ws);
    });
});

/* =====================================================
   HEARTBEAT
===================================================== */

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

/* =====================================================
   START
===================================================== */

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            `VedChat running on port ${PORT}`
        );

        console.log(
            `Users: ${Object.keys(users).length}`
        );
    }
);