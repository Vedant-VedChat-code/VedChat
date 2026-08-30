const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;

const PUBLIC_DIR = path.join(__dirname, "public");
const USERS_FILE = path.join(__dirname, "users.json");
const GROUPS_FILE = path.join(__dirname, "groups.json");

let users = loadJSON(USERS_FILE, {});
let groups = loadJSON(GROUPS_FILE, {});

const clients = new Map();

/* =====================================================
   DATABASE
===================================================== */

function loadJSON(file, fallback) {
    try {
        if (!fs.existsSync(file)) {
            fs.writeFileSync(
                file,
                JSON.stringify(fallback, null, 2),
                "utf8"
            );
            return fallback;
        }

        const data = fs.readFileSync(file, "utf8");

        if (!data.trim()) {
            return fallback;
        }

        return JSON.parse(data);
    } catch (error) {
        console.error("Database load error:", error);
        return fallback;
    }
}

function saveJSON(file, data) {
    try {
        fs.writeFileSync(
            file,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch (error) {
        console.error("Database save error:", error);
    }
}

/* =====================================================
   HELPERS
===================================================== */

const CODE_CHARS =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const MAX_NAME = 40;
const MAX_TEXT = 5000;
const MAX_AVATAR = 1024 * 1024 * 2;

function generateCode() {
    let code;

    do {
        code = "";

        for (let i = 0; i < 10; i++) {
            code += CODE_CHARS[
                crypto.randomInt(0, CODE_CHARS.length)
            ];
        }
    } while (users[code]);

    return code;
}

function generateGroupId() {
    return crypto.randomBytes(12).toString("hex");
}

function cleanName(value) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, MAX_NAME);
}

function cleanText(value) {
    return String(value || "")
        .slice(0, MAX_TEXT);
}

function cleanCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .slice(0, 10);
}

function cleanGroupId(value) {
    return String(value || "")
        .trim()
        .slice(0, 100);
}

function cleanAvatar(value) {
    return String(value || "")
        .slice(0, MAX_AVATAR);
}

function send(ws, data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(JSON.stringify(data));
        } catch (error) {
            console.error("WebSocket send error:", error);
        }
    }
}

function sendError(ws, message) {
    send(ws, {
        type: "error",
        message: String(message || "Unknown error.")
    });
}

function getUser(code) {
    return users[code] || null;
}

function getClient(code) {
    for (const [ws, info] of clients.entries()) {
        if (info.code === code) {
            return ws;
        }
    }

    return null;
}

function sendToUser(code, data) {
    const ws = getClient(code);

    if (ws) {
        send(ws, data);
    }
}

function sendToUsers(codes, data, exceptCode = null) {
    for (const code of codes || []) {
        if (code === exceptCode) continue;
        sendToUser(code, data);
    }
}

function isOnline(code) {
    return !!getClient(code);
}

/* =====================================================
   USER DATA
===================================================== */

function publicUser(code) {
    const user = users[code];

    if (!user) return null;

    return {
        code: user.code,
        name: user.name,
        avatar: user.avatar || "",
        online: isOnline(code)
    };
}

function friendsForUser(code) {
    const user = users[code];

    if (!user) return [];

    return (user.friends || [])
        .map(friendCode => publicUser(friendCode))
        .filter(Boolean);
}

/* =====================================================
   GROUP DATA
===================================================== */

function groupExists(groupId) {
    return !!groups[groupId];
}

function groupHasMember(groupId, code) {
    const group = groups[groupId];

    if (!group) return false;

    return group.members.includes(code);
}

function sendToGroup(groupId, data, exceptCode = null) {
    const group = groups[groupId];

    if (!group) return;

    for (const code of group.members) {
        if (code === exceptCode) continue;

        sendToUser(code, data);
    }
}

/* =====================================================
   HTTP SERVER
===================================================== */

const server = http.createServer((req, res) => {
    let requestPath = req.url.split("?")[0];

    if (requestPath === "/") {
        requestPath = "/index.html";
    }

    const safePath =
        path.normalize(requestPath)
            .replace(/^(\.\.[/\\])+/, "");

    const filePath =
        path.join(PUBLIC_DIR, safePath);

    if (
        !filePath.startsWith(
            path.resolve(PUBLIC_DIR)
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
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".ico": "image/x-icon"
        };

        res.writeHead(200, {
            "Content-Type":
                contentTypes[ext] ||
                "application/octet-stream",
            "Cache-Control":
                ext === ".html"
                    ? "no-cache"
                    : "public, max-age=3600"
        });

        res.end(data);
    });
});

/* =====================================================
   WEBSOCKET SERVER
===================================================== */

const wss = new WebSocket.Server({
    server,
    maxPayload: 1024 * 1024 * 3
});

/* =====================================================
   CONNECTION
===================================================== */

wss.on("connection", ws => {
    ws.isAlive = true;

    send(ws, {
        type: "server-ready",
        version: 3
    });

    ws.on("pong", () => {
        ws.isAlive = true;
    });

    ws.on("error", error => {
        console.error("WebSocket error:", error);
    });

    ws.on("message", raw => {
        let message;

        try {
            message =
                JSON.parse(raw.toString());
        } catch {
            sendError(
                ws,
                "Invalid JSON message."
            );
            return;
        }

        if (
            !message ||
            typeof message !== "object"
        ) {
            sendError(
                ws,
                "Invalid message."
            );
            return;
        }

        const type =
            typeof message.type === "string"
                ? message.type
                : "";

        /* =================================================
           REGISTER
        ================================================= */

        if (type === "register") {
            if (clients.has(ws)) {
                sendError(
                    ws,
                    "Already registered."
                );
                return;
            }

            const name =
                cleanName(message.name);

            if (!name) {
                sendError(
                    ws,
                    "Please enter a display name."
                );
                return;
            }

            let code =
                cleanCode(message.code);

            let isExisting = false;

            if (code && users[code]) {
                isExisting = true;
            } else {
                code = generateCode();
            }

            if (!users[code]) {
                users[code] = {
                    code,
                    name,
                    avatar:
                        cleanAvatar(
                            message.avatar
                        ),
                    friends: [],
                    createdAt:
                        new Date().toISOString()
                };
            } else {
                users[code].name = name;

                if (
                    message.avatar !== undefined
                ) {
                    users[code].avatar =
                        cleanAvatar(
                            message.avatar
                        );
                }

                if (
                    !Array.isArray(
                        users[code].friends
                    )
                ) {
                    users[code].friends = [];
                }
            }

            saveJSON(
                USERS_FILE,
                users
            );

            clients.set(ws, {
                code,
                name
            });

            send(ws, {
                type: "registered",
                code,
                name: users[code].name,
                avatar:
                    users[code].avatar || "",
                friends:
                    users[code].friends || [],
                existing: isExisting
            });

            /* Notify friends that user is online */

            sendToUsers(
                users[code].friends || [],
                {
                    type: "presence",
                    code,
                    online: true
                }
            );

            return;
        }

        /* =================================================
           AUTHENTICATION
        ================================================= */

        const info =
            clients.get(ws);

        if (!info) {
            sendError(
                ws,
                "Register first."
            );
            return;
        }

        const user =
            users[info.code];

        if (!user) {
            sendError(
                ws,
                "User account not found."
            );
            return;
        }

        /* =================================================
           PROFILE
        ================================================= */

        if (type === "update-profile") {
            const name =
                cleanName(message.name);

            if (!name) {
                sendError(
                    ws,
                    "Invalid display name."
                );
                return;
            }

            user.name = name;

            if (
                message.avatar !== undefined
            ) {
                user.avatar =
                    cleanAvatar(
                        message.avatar
                    );
            }

            info.name = name;

            saveJSON(
                USERS_FILE,
                users
            );

            send(ws, {
                type: "profile-updated",
                code: info.code,
                name: user.name,
                avatar:
                    user.avatar || ""
            });

            /* Tell friends about updated profile */

            sendToUsers(
                user.friends || [],
                {
                    type: "friend-profile-updated",
                    user: publicUser(info.code)
                }
            );

            return;
        }

        /* =================================================
           LOOKUP USER
        ================================================= */

        if (type === "lookup-user") {
            const code =
                cleanCode(message.code);

            if (
                code.length !== 10 ||
                !users[code]
            ) {
                sendError(
                    ws,
                    "User not found."
                );
                return;
            }

            send(ws, {
                type: "user-found",
                user: publicUser(code)
            });

            return;
        }

        /* =================================================
           ADD FRIEND
        ================================================= */

        if (type === "add-friend") {
            const friendCode =
                cleanCode(message.code);

            if (!users[friendCode]) {
                sendError(
                    ws,
                    "Friend code not found."
                );
                return;
            }

            if (friendCode === info.code) {
                sendError(
                    ws,
                    "You cannot add yourself."
                );
                return;
            }

            if (
                !Array.isArray(
                    user.friends
                )
            ) {
                user.friends = [];
            }

            if (
                !user.friends.includes(
                    friendCode
                )
            ) {
                user.friends.push(
                    friendCode
                );
            }

            if (
                !Array.isArray(
                    users[friendCode].friends
                )
            ) {
                users[friendCode].friends = [];
            }

            if (
                !users[friendCode]
                    .friends
                    .includes(info.code)
            ) {
                users[friendCode]
                    .friends
                    .push(info.code);
            }

            saveJSON(
                USERS_FILE,
                users
            );

            send(ws, {
                type: "friends-updated",
                friends:
                    friendsForUser(info.code)
            });

            sendToUser(
                friendCode,
                {
                    type: "friend-added",
                    user:
                        publicUser(info.code)
                }
            );

            return;
        }

        /* =================================================
           GET FRIENDS
        ================================================= */

        if (type === "get-friends") {
            send(ws, {
                type: "friends-list",
                friends:
                    friendsForUser(info.code)
            });

            return;
        }

        /* =================================================
           PRIVATE CHAT
        ================================================= */

        if (type === "private-chat") {
            const to =
                cleanCode(message.to);

            const text =
                cleanText(message.text);

            if (!users[to]) {
                sendError(
                    ws,
                    "User not found."
                );
                return;
            }

            if (!text.trim()) {
                return;
            }

            const packet = {
                type: "private-chat",
                from: info.code,
                to,
                sender: user.name,
                avatar:
                    user.avatar || "",
                text,
                time:
                    new Date().toISOString()
            };

            sendToUser(to, packet);

            /*
             * Echo to sender.
             * This allows both devices to use
             * the same message format.
             */

            send(ws, packet);

            return;
        }

        /* =================================================
           CREATE GROUP
        ================================================= */

        if (type === "create-group") {
            const groupName =
                cleanName(message.name);

            if (!groupName) {
                sendError(
                    ws,
                    "Enter a group name."
                );
                return;
            }

            const groupId =
                generateGroupId();

            const group = {
                id: groupId,
                name: groupName,
                owner: info.code,
                members: [
                    info.code
                ],
                createdAt:
                    new Date().toISOString()
            };

            groups[groupId] = group;

            saveJSON(
                GROUPS_FILE,
                groups
            );

            send(ws, {
                type: "group-created",
                group
            });

            return;
        }

        /* =================================================
           JOIN GROUP
        ================================================= */

        if (type === "join-group") {
            const groupId =
                cleanGroupId(
                    message.groupId
                );

            const group =
                groups[groupId];

            if (!group) {
                sendError(
                    ws,
                    "Group not found."
                );
                return;
            }

            if (
                !group.members.includes(
                    info.code
                )
            ) {
                group.members.push(
                    info.code
                );

                saveJSON(
                    GROUPS_FILE,
                    groups
                );
            }

            send(ws, {
                type: "group-joined",
                group
            });

            sendToGroup(
                groupId,
                {
                    type:
                        "group-member-joined",
                    groupId,
                    code: info.code,
                    name: user.name,
                    avatar:
                        user.avatar || ""
                },
                info.code
            );

            return;
        }

        /* =================================================
           GET GROUPS
        ================================================= */

        if (type === "get-groups") {
            const result =
                Object.values(groups)
                    .filter(group =>
                        group.members.includes(
                            info.code
                        )
                    );

            send(ws, {
                type: "groups-list",
                groups: result
            });

            return;
        }

        /* =================================================
           GROUP CHAT
        ================================================= */

        if (type === "group-chat") {
            const groupId =
                cleanGroupId(
                    message.groupId
                );

            const group =
                groups[groupId];

            if (!group) {
                sendError(
                    ws,
                    "Group not found."
                );
                return;
            }

            if (
                !group.members.includes(
                    info.code
                )
            ) {
                sendError(
                    ws,
                    "You are not in this group."
                );
                return;
            }

            const text =
                cleanText(message.text);

            if (!text.trim()) return;

            const packet = {
                type: "group-chat",
                groupId,
                from: info.code,
                sender: user.name,
                avatar:
                    user.avatar || "",
                text,
                time:
                    new Date().toISOString()
            };

            sendToGroup(
                groupId,
                packet
            );

            return;
        }

        /* =================================================
           CALL SIGNALING
        ================================================= */

        const signalingTypes = [
            "call-invite",
            "call-offer",
            "call-answer",
            "ice-candidate",
            "call-decline",
            "call-end",
            "call-leave"
        ];

        if (
            signalingTypes.includes(type)
        ) {
            /*
             * GROUP CALL
             */

            if (message.groupId) {
                const groupId =
                    cleanGroupId(
                        message.groupId
                    );

                const group =
                    groups[groupId];

                if (!group) {
                    sendError(
                        ws,
                        "Group not found."
                    );
                    return;
                }

                if (
                    !group.members.includes(
                        info.code
                    )
                ) {
                    sendError(
                        ws,
                        "You are not in this group."
                    );
                    return;
                }

                /*
                 * For group calls, send the
                 * signaling packet to everyone
                 * except the sender.
                 */

                sendToGroup(
                    groupId,
                    {
                        ...message,
                        type,
                        from: info.code,
                        sender: user.name,
                        avatar:
                            user.avatar || ""
                    },
                    info.code
                );

                return;
            }

            /*
             * PRIVATE CALL
             */

            const to =
                cleanCode(message.to);

            if (!to || !users[to]) {
                sendError(
                    ws,
                    "Call recipient not found."
                );
                return;
            }

            sendToUser(
                to,
                {
                    ...message,
                    type,
                    from: info.code,
                    sender: user.name,
                    avatar:
                        user.avatar || ""
                }
            );

            return;
        }

        /* =================================================
           PING
        ================================================= */

        if (type === "ping") {
            send(ws, {
                type: "pong",
                time:
                    new Date().toISOString()
            });

            return;
        }

        /* =================================================
           UNKNOWN MESSAGE
        ================================================= */

        console.warn(
            "Unknown message type:",
            type,
            message
        );

        sendError(
            ws,
            "Unknown message type: " +
            (type || "undefined")
        );
    });

    /* =====================================================
       CLOSE
    ===================================================== */

    ws.on("close", () => {
        const info =
            clients.get(ws);

        if (info) {
            const user =
                users[info.code];

            if (user) {
                sendToUsers(
                    user.friends || [],
                    {
                        type: "presence",
                        code: info.code,
                        online: false
                    }
                );
            }
        }

        clients.delete(ws);
    });
});

/* =====================================================
   HEARTBEAT
===================================================== */

const heartbeat =
    setInterval(() => {
        for (const ws of wss.clients) {
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }

            ws.isAlive = false;

            try {
                ws.ping();
            } catch {}
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
            "================================="
        );

        console.log(
            "       VEDCHAT SERVER V3"
        );

        console.log(
            "================================="
        );

        console.log(
            `Server: http://0.0.0.0:${PORT}`
        );

        console.log(
            `Users: ${Object.keys(users).length}`
        );

        console.log(
            `Groups: ${Object.keys(groups).length}`
        );
    }
);