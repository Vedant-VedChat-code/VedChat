const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;
const root = __dirname;

const users = new Map();
const friends = new Map();
const groups = new Map();
const sockets = new Map();

const PENDING_FILE = path.join(root, "pending_messages.json");
const MAX_PENDING_PER_USER = 1000;
const MAX_MESSAGE_JSON = 16000;

let pendingMessages = new Map();

function loadPendingMessages() {
    try {
        const raw = fs.readFileSync(PENDING_FILE, "utf8");
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return;
        for (const [code, list] of Object.entries(data)) {
            if (Array.isArray(list)) pendingMessages.set(code, list.slice(-MAX_PENDING_PER_USER));
        }
    } catch {}
}

function savePendingMessages() {
    try {
        const data = Object.fromEntries(pendingMessages.entries());
        fs.writeFileSync(PENDING_FILE, JSON.stringify(data), "utf8");
    } catch (error) {
        console.error("Could not save pending messages:", error.message);
    }
}

function queueForUser(code, message) {
    if (!code) return;
    const list = pendingMessages.get(code) || [];
    list.push(message);
    if (list.length > MAX_PENDING_PER_USER) {
        list.splice(0, list.length - MAX_PENDING_PER_USER);
    }
    pendingMessages.set(code, list);
    savePendingMessages();
}

function deliverPending(code, ws) {
    const list = pendingMessages.get(code);
    if (!list || !list.length) return;

    for (const message of list) {
        send(ws, message);
    }

    pendingMessages.delete(code);
    savePendingMessages();
}

function code() {
    let c = "";
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    do {
        c = "";
        for (let i = 0; i < 10; i++) {
            c += chars[Math.floor(Math.random() * chars.length)];
        }
    } while (users.has(c));
    return c;
}

function send(ws, message) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        try {
            ws.send(JSON.stringify(message));
            return true;
        } catch {}
    }
    return false;
}

function safeUser(codeValue) {
    return users.get(codeValue) || null;
}

function relayPrivate(me, message) {
    const target = String(message.to || "").trim().toUpperCase();
    if (!target || !users.has(target)) return;

    const sender = safeUser(me);
    const outgoing = {
        ...message,
        from: me,
        sender: sender?.name || "User",
        avatar: sender?.avatar || "",
        time: message.time || new Date().toISOString()
    };

    const targetSocket = sockets.get(target);
    if (!send(targetSocket, outgoing)) {
        queueForUser(target, outgoing);
    }

    // Echo to sender so the existing client can confirm/deduplicate the message.
    send(sockets.get(me), outgoing);
}

function relayGroup(me, message) {
    const group = groups.get(message.groupId);
    if (!group) return;

    const sender = safeUser(me);
    const outgoing = {
        ...message,
        from: me,
        sender: sender?.name || "User",
        avatar: sender?.avatar || "",
        time: message.time || new Date().toISOString()
    };

    for (const member of group.members) {
        if (member === me) {
            send(sockets.get(member), outgoing);
            continue;
        }

        if (!send(sockets.get(member), outgoing)) {
            queueForUser(member, outgoing);
        }
    }
}

loadPendingMessages();

const server = http.createServer((req, res) => {
    let urlPath = req.url.split("?")[0];
    if (urlPath === "/") urlPath = "/index.html";

    // Prevent path traversal and only serve files below the project root.
    const file = path.resolve(root, "." + urlPath);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        return res.end("Not found");
    }

    const ext = path.extname(file).toLowerCase();
    const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".mp3": "audio/mpeg"
    };

    res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });

    fs.createReadStream(file).pipe(res);
});

const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
    let me = null;

    ws.on("message", raw => {
        if (raw.length > MAX_MESSAGE_JSON) return;

        let m;
        try {
            m = JSON.parse(raw.toString());
        } catch {
            return;
        }

        if (!m || typeof m !== "object") return;

        if (m.type === "register") {
            me = m.code || code();

            if (!users.has(me)) {
                users.set(me, {
                    code: me,
                    name: String(m.name || "Guest").slice(0, 40),
                    avatar: String(m.avatar || "")
                });
            } else {
                Object.assign(users.get(me), {
                    name: String(m.name || users.get(me).name).slice(0, 40),
                    avatar: String(m.avatar || users.get(me).avatar || "")
                });
            }

            sockets.set(me, ws);
            send(ws, { type: "registered", ...users.get(me) });
            deliverPending(me, ws);
            return;
        }

        if (!me) return;

        if (m.type === "ping") {
            send(ws, { type: "pong" });
            return;
        }

        if (m.type === "update-profile") {
            Object.assign(users.get(me), {
                name: String(m.name || users.get(me).name).slice(0, 40),
                avatar: String(m.avatar || "")
            });
            send(ws, { type: "profile-updated", ...users.get(me) });
            return;
        }

        if (m.type === "lookup-user") {
            const user = users.get(String(m.code || "").toUpperCase());
            if (user) {
                send(ws, {
                    type: "user-found",
                    user: { ...user, online: sockets.has(user.code) }
                });
            } else {
                send(ws, { type: "error", message: "User not found." });
            }
            return;
        }

        if (m.type === "add-friend") {
            const target = String(m.code || "").toUpperCase();
            if (!users.has(target) || target === me) return;

            const a = friends.get(me) || new Set();
            const b = friends.get(target) || new Set();
            a.add(target);
            b.add(me);
            friends.set(me, a);
            friends.set(target, b);

            send(ws, { type: "friends-updated" });
            send(sockets.get(target), { type: "friends-updated" });
            return;
        }

        if (m.type === "get-friends") {
            const list = [...(friends.get(me) || [])]
                .map(c => users.get(c))
                .filter(Boolean)
                .map(u => ({ ...u, online: sockets.has(u.code) }));
            send(ws, { type: "friends-list", friends: list });
            return;
        }

        if (m.type === "private-chat") {
            if (typeof m.text !== "string") return;
            relayPrivate(me, {
                type: "private-chat",
                to: String(m.to || "").toUpperCase(),
                text: m.text,
                clientId: m.clientId,
                time: m.time
            });
            return;
        }

        if (m.type === "create-group") {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
            const group = {
                id,
                name: String(m.name || "Group").slice(0, 50),
                members: [me]
            };
            groups.set(id, group);
            send(ws, { type: "group-created", group });
            return;
        }

        if (m.type === "get-groups") {
            send(ws, {
                type: "groups-list",
                groups: [...groups.values()].filter(g => g.members.includes(me))
            });
            return;
        }

        if (m.type === "group-chat") {
            if (typeof m.text !== "string") return;
            relayGroup(me, {
                type: "group-chat",
                groupId: m.groupId,
                text: m.text,
                clientId: m.clientId,
                time: m.time
            });
            return;
        }

        if (["call-offer", "call-answer", "ice-candidate", "call-decline", "call-end", "call-invite"].includes(m.type)) {
            const sender = safeUser(me);
            const outgoing = {
                ...m,
                from: me,
                sender: sender?.name,
                avatar: sender?.avatar
            };

            if (m.to) {
                send(sockets.get(String(m.to).toUpperCase()), outgoing);
            } else if (m.groupId) {
                const group = groups.get(m.groupId);
                group?.members.forEach(member => {
                    if (member !== me) send(sockets.get(member), outgoing);
                });
            }
        }
    });

    ws.on("close", () => {
        if (me && sockets.get(me) === ws) {
            sockets.delete(me);
        }
    });
});

server.listen(PORT, () => {
    console.log(`VedChat running on port ${PORT}`);
});
