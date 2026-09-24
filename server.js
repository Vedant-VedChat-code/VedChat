const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const MAX_IMAGE_DATA = 35 * 1024 * 1024;
const MAX_AVATAR_DATA = 30 * 1024 * 1024;

const PUBLIC_DIR =
    path.join(__dirname, "public");

const USERS_FILE =
    path.join(__dirname, "users.json");

const GROUPS_FILE =
    path.join(__dirname, "groups.json");

const PENDING_MESSAGES_FILE =
    path.join(__dirname, "pending_messages.json");

const MESSAGE_HISTORY_FILE =
    path.join(__dirname, "message_history.json");

const RANKS_FILE =
    path.join(__dirname, "ranks.json");

const AUTH_FILE =
    path.join(__dirname, "auth_accounts.json");

const VOICE_DIR =
    path.join(__dirname, "voice");

const MAX_VOICE_BYTES = 2 * 1024 * 1024;

const VIBES_FILE =
    path.join(__dirname, "vibes.json");

const VIBE_MAX_PER_USER = 20;
const VIBE_MAX_TEXT = 500;
const VIBE_MAX_IMAGE_DATA = 5 * 1024 * 1024;
const VIBE_TTL_MS = 24 * 60 * 60 * 1000;

const OWNER_PASSWORD =
    String(process.env.VEDCHAT_OWNER_PASSWORD || "111014");

const VALID_RANKS =
    new Set(["owner", "admin", ""]);


let users = {};
let groups = {};
let messageHistory = {};
let ranks = {};
let vibes = {};


const clients = new Map();


/* =====================================================
   VIBE / STATUS SYSTEM
===================================================== */

function cleanVibeText(value) {
    return String(value || "").trim().slice(0, VIBE_MAX_TEXT);
}

function cleanVibeImage(value) {
    const image = String(value || "");
    if (!image.startsWith("data:image/")) return "";
    return image.slice(0, VIBE_MAX_IMAGE_DATA);
}

function cleanupVibes() {
    const now = Date.now();
    let changed = false;
    for (const code of Object.keys(vibes)) {
        const list = Array.isArray(vibes[code]) ? vibes[code] : [];
        const next = list.filter(v => v && Number(v.expiresAt || 0) > now);
        if (next.length !== list.length) changed = true;
        if (next.length) vibes[code] = next;
        else { delete vibes[code]; if (list.length) changed = true; }
    }
    if (changed) saveJSON(VIBES_FILE, vibes);
}

function visibleVibeOwners(code) {
    const user = users[code];
    if (!user) return [];
    const friends = Array.isArray(user.friends) ? user.friends.map(cleanCode) : [];
    return [code, ...friends.filter(Boolean)];
}

function publicVibe(vibe, owner) {
    return {
        id: vibe.id,
        owner: vibe.owner,
        name: owner?.name || vibe.name || "User",
        avatar: owner?.avatar || vibe.avatar || "",
        text: vibe.text || "",
        image: vibe.image || "",
        audio: vibe.audio || "",
        audioDuration: Number(vibe.audioDuration || 0),
        createdAt: vibe.createdAt,
        expiresAt: vibe.expiresAt
    };
}

function getVisibleVibes(code) {
    cleanupVibes();
    return visibleVibeOwners(code).flatMap(ownerCode => {
        const owner = users[ownerCode];
        return (vibes[ownerCode] || []).map(v => publicVibe(v, owner));
    }).sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
}

setInterval(cleanupVibes, 60 * 60 * 1000);

/* =====================================================
   RANK SYSTEM
===================================================== */

function normalizeRank(rank) {
    const value = String(rank || "").trim().toLowerCase();
    return VALID_RANKS.has(value) ? value : "";
}

function getRank(code) {
    code = cleanCode(code);
    return normalizeRank(
        ranks[code] ||
        (users[code] && users[code].rank) ||
        ""
    );
}

function setRank(code, rank) {
    code = cleanCode(code);
    rank = normalizeRank(rank);

    if (rank) ranks[code] = rank;
    else delete ranks[code];

    if (users[code]) users[code].rank = rank;
    saveJSON(RANKS_FILE, ranks);
    saveJSON(USERS_FILE, users);
}

/* =====================================================
   DATABASE
===================================================== */

function loadJSON(file, fallback) {

    try {

        if (!fs.existsSync(file)) {

            fs.writeFileSync(
                file,
                JSON.stringify(
                    fallback,
                    null,
                    2
                ),
                "utf8"
            );

            return fallback;
        }


        const data =
            fs.readFileSync(
                file,
                "utf8"
            );


        if (!data.trim()) {
            return fallback;
        }


        return JSON.parse(data);

    } catch (error) {

        console.error(
            "Database load error:",
            error
        );

        return fallback;
    }
}


function saveJSON(file, data) {

    try {

        fs.writeFileSync(
            file,
            JSON.stringify(
                data,
                null,
                2
            ),
            "utf8"
        );

    } catch (error) {

        console.error(
            "Database save error:",
            error
        );
    }
}


users =
    loadJSON(
        USERS_FILE,
        {}
    );

groups =
    loadJSON(
        GROUPS_FILE,
        {}
    );

pendingMessages =
    loadJSON(
        PENDING_MESSAGES_FILE,
        {}
    );
messageHistory = loadJSON(MESSAGE_HISTORY_FILE, {});
ranks = loadJSON(RANKS_FILE, {});
vibes = loadJSON(VIBES_FILE, {});
authAccounts = loadJSON(AUTH_FILE, {});
if (!fs.existsSync(VOICE_DIR)) fs.mkdirSync(VOICE_DIR, { recursive: true });


/* =====================================================
   ACCOUNT AUTHENTICATION
===================================================== */

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 24);
}

function hashPassword(password, salt) {
    return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function makePasswordRecord(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    return { salt, hash: hashPassword(password, salt) };
}

function findAccountByCode(code) {
    return Object.values(authAccounts).find(a => a && a.code === code) || null;
}

function publicAccount(account) {
    return account ? { username: account.username, code: account.code } : null;
}

/* =====================================================
   HELPERS
===================================================== */

const CODE_CHARS =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


function generateCode() {

    let code;

    do {

        code = "";

        for (
            let i = 0;
            i < 10;
            i++
        ) {

            code +=
                CODE_CHARS[
                    crypto.randomInt(
                        0,
                        CODE_CHARS.length
                    )
                ];
        }

    } while (users[code]);


    return code;
}


function generateGroupId() {

    return crypto
        .randomBytes(12)
        .toString("hex");
}


function cleanName(name) {

    return String(
        name || ""
    )
        .trim()
        .slice(0, 40);
}


function cleanText(text) {

    return String(
        text || ""
    )
        .slice(0, 5000);
}


function cleanCode(code) {

    return String(
        code || ""
    )
        .trim()
        .toUpperCase()
        .slice(0, 20);
}


function send(ws, data) {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        try {

            ws.send(
                JSON.stringify(data)
            );

        } catch (error) {

            console.error(
                "Send error:",
                error
            );
        }
    }
}


function sendError(
    ws,
    message,
    extra = null
) {

    const payload = {
        type: "error",
        message
    };
    if (extra && typeof extra === "object") Object.assign(payload, extra);
    send(ws, payload);
}


function getClient(code) {

    for (
        const [
            ws,
            info
        ] of clients.entries()
    ) {

        if (
            info.code === code
        ) {

            return ws;
        }
    }

    return null;
}


function isUserActive(code) {
    for (const [, info] of clients.entries()) {
        if (info && info.code === code && info.active === true) return true;
    }
    return false;
}

function broadcastPresence(code) {
    const user = users[code];
    if (!user) return;
    sendToUsers(user.friends || [], { type: "presence", code, online: isUserActive(code), lastSeen: user.lastSeen || null }, code);
}

function sendToUser(
    code,
    data
) {
    // A user can have two legitimate connections: the foreground WebView
    // and the Android background receiver. Sending to only the first socket
    // makes messages, call signaling, edits and deletes randomly disappear.
    for (const [socket, info] of clients.entries()) {
        if (info && info.code === code) {
            send(socket, data);
        }
    }
}


function sendToUsers(
    codes,
    data,
    exceptCode = null
) {

    for (
        const code of
        codes || []
    ) {

        if (
            code === exceptCode
        ) {
            continue;
        }

        sendToUser(
            code,
            data
        );
    }
}


function sendToGroup(
    groupId,
    data,
    exceptCode = null
) {

    const group =
        groups[groupId];

    if (!group) {
        return;
    }


    for (
        const code of
        group.members || []
    ) {

        if (
            code === exceptCode
        ) {
            continue;
        }

        sendToUser(
            code,
            data
        );
    }
}


function userExists(code) {

    return !!users[code];
}


/* =====================================================
   MESSAGE HISTORY / EDIT / DELETE SUPPORT
===================================================== */

function saveMessageHistory() {
    saveJSON(MESSAGE_HISTORY_FILE, messageHistory);
}

function rememberPrivateMessage(packet) {
    if (!packet || !packet.messageId) return;
    messageHistory[packet.messageId] = {
        messageId: packet.messageId,
        from: packet.from,
        to: packet.to,
        text: packet.text || "",
        // Do not duplicate large base64 image payloads into message_history.json.
        // Edit/delete only needs to know that the message exists; queued delivery
        // still keeps the real image until the recipient receives it.
        image: packet.image || "",
        sender: packet.sender || "",
        avatar: packet.avatar || "",
        time: packet.time || new Date().toISOString(),
        edited: !!packet.edited,
        deleted: !!packet.deleted
    };
    const keys = Object.keys(messageHistory);
    if (keys.length > 2000) {
        keys.slice(0, keys.length - 10000).forEach(k => delete messageHistory[k]);
    }
    saveMessageHistory();
}

function getMessageRecord(messageId, from, to) {
    const record = messageHistory[messageId];
    if (!record) return null;
    if (record.from !== from || record.to !== to) return null;
    return record;
}

function queueMessageEvent(code, payload) {
    if (!pendingMessages[code]) pendingMessages[code] = [];
    // Replace an older edit/delete for the same message instead of stacking
    // stale operations. The latest state is what the recipient needs.
    const existingIndex = pendingMessages[code].findIndex(function(item) {
        return item && item.type &&
            (item.type === "message-updated" || item.type === "message-deleted") &&
            item.messageId === payload.messageId;
    });
    if (existingIndex >= 0) pendingMessages[code][existingIndex] = payload;
    else pendingMessages[code].push(payload);
    if (pendingMessages[code].length > 1000) {
        pendingMessages[code].splice(0, pendingMessages[code].length - 1000);
    }
    savePendingMessages();
}

function removePendingMessage(code, messageId) {
    const queue = pendingMessages[code];
    if (!Array.isArray(queue)) return;
    const next = queue.filter(item => !(item && item.messageId === messageId));
    if (next.length !== queue.length) {
        pendingMessages[code] = next;
        savePendingMessages();
    }
}

/* =====================================================
   OFFLINE MESSAGE QUEUE
===================================================== */

function savePendingMessages() {
    saveJSON(
        PENDING_MESSAGES_FILE,
        pendingMessages
    );
}

function queuePrivateMessage(code, packet) {
    if (!pendingMessages[code]) {
        pendingMessages[code] = [];
    }

    // A message stays in the server delivery queue until the recipient
    // explicitly ACKs it. WebSocket.send() alone is not proof that the
    // recipient actually received/processed the message.
    if (packet && packet.messageId &&
        pendingMessages[code].some(item => item && item.messageId === packet.messageId && item.type === packet.type)) {
        return;
    }

    pendingMessages[code].push(packet);

    if (pendingMessages[code].length > 5000) {
        pendingMessages[code].splice(
            0,
            pendingMessages[code].length - 5000
        );
    }

    savePendingMessages();
}

function acknowledgeDeliveredMessage(code, messageId, type, groupId) {
    const queue = pendingMessages[code];
    if (!Array.isArray(queue) || !messageId) return false;

    const next = queue.filter(function(item) {
        if (!item || item.messageId !== messageId) return true;
        if (type && item.type !== type) return true;
        if (groupId && item.groupId !== groupId) return true;
        return false;
    });

    if (next.length === queue.length) return false;
    pendingMessages[code] = next;
    savePendingMessages();
    return true;
}

function deliverPendingMessages(ws, code) {
    const queue = pendingMessages[code];

    if (!Array.isArray(queue) || queue.length === 0) {
        return;
    }

    // IMPORTANT: do not delete the queue here. The recipient must ACK each
    // message. If the socket dies immediately after send(), the message will
    // still be delivered on the next connection.
    for (const packet of queue) {
        send(ws, packet);
    }

    console.log(
        `Sent ${queue.length} queued message(s) to ${code}; waiting for ACK`
    );
}

/* =====================================================
   HTTP SERVER
===================================================== */

const server =
    http.createServer(
        (req, res) => {

            let requestPath =
                req.url.split("?")[0];

            if (requestPath === "/health") {
                res.writeHead(200, {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store"
                });
                res.end(JSON.stringify({
                    ok: true,
                    service: "VedChat",
                    version: "2026-09-24-v10"
                }));
                return;
            }

            if (requestPath.startsWith("/voice/")) {
                const name = path.basename(requestPath);
                const filePath = path.join(VOICE_DIR, name);
                if (!filePath.startsWith(VOICE_DIR) || !fs.existsSync(filePath)) {
                    res.writeHead(404); res.end("Not found"); return;
                }
                const ext = path.extname(filePath).toLowerCase();
                const types = { ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp4": "audio/mp4", ".m4a": "audio/mp4", ".wav": "audio/wav" };
                res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
                fs.createReadStream(filePath).pipe(res);
                return;
            }

            if (
                requestPath === "/"
            ) {

                requestPath =
                    "/index.html";
            }


            let filePath =
                path.normalize(
                    path.join(
                        PUBLIC_DIR,
                        requestPath
                    )
                );


            if (
                !filePath.startsWith(
                    PUBLIC_DIR
                )
            ) {

                res.writeHead(403);

                res.end(
                    "Forbidden"
                );

                return;
            }


            fs.readFile(
                filePath,
                (error, data) => {

                    if (error) {

                        res.writeHead(
                            404,
                            {
                                "Content-Type":
                                    "text/plain"
                            }
                        );

                        res.end(
                            "Not found"
                        );

                        return;
                    }


                    const ext =
                        path.extname(
                            filePath
                        )
                            .toLowerCase();


                    const types = {

                        ".html":
                            "text/html; charset=utf-8",

                        ".css":
                            "text/css; charset=utf-8",

                        ".js":
                            "application/javascript; charset=utf-8",

                        ".json":
                            "application/json",

                        ".png":
                            "image/png",

                        ".jpg":
                            "image/jpeg",

                        ".jpeg":
                            "image/jpeg",

                        ".webp":
                            "image/webp",

                        ".svg":
                            "image/svg+xml",

                        ".ico":
                            "image/x-icon"
                    };


                    res.writeHead(
                        200,
                        {
                            "Content-Type":
                                types[ext] ||
                                "application/octet-stream",

                            "Cache-Control":
                                "no-cache"
                        }
                    );


                    res.end(data);
                }
            );
        }
    );


/* =====================================================
   WEBSOCKET
===================================================== */

const wss =
    new WebSocket.Server({
        server,
        // JSON + base64 overhead; client compresses chat images before sending.
        maxPayload: 40 * 1024 * 1024
    });


/* =====================================================
   CONNECTION
===================================================== */

wss.on(
    "connection",
    ws => {

        ws.isAlive = true;
        ws.lastPongAt = Date.now();


        send(
            ws,
            {
                type:
                    "server-ready"
            }
        );


        ws.on(
            "pong",
            () => {
                ws.isAlive = true;
                ws.lastPongAt = Date.now();
            }
        );


        ws.on(
            "error",
            error => {

                console.error(
                    "WebSocket error:",
                    error
                );
            }
        );


        ws.on(
            "message",
            raw => {

                let message;


                try {

                    message =
                        JSON.parse(
                            raw.toString()
                        );

                } catch {

                    sendError(
                        ws,
                        "Invalid message."
                    );

                    return;
                }


                if (
                    !message ||
                    typeof message.type !==
                        "string"
                ) {

                    sendError(
                        ws,
                        "Invalid message type."
                    );

                    return;
                }


                /* =========================================
                   REGISTER
                ========================================= */

                if (
                    message.type ===
                    "register"
                ) {

                    if (
                        clients.has(ws)
                    ) {

                        sendError(
                            ws,
                            "Already registered."
                        );

                        return;
                    }


                    const name =
                        cleanName(
                            message.name
                        );


                    if (!name) {

                        sendError(
                            ws,
                            "Please enter a display name."
                        );

                        return;
                    }


                    let code =
                        cleanCode(
                            message.code
                        );

                    const existingAccount = code ? findAccountByCode(code) : null;
                    if (existingAccount && existingAccount.authToken !== String(message.authToken || "")) {
                        sendError(ws, "Please sign in to this account first.", { auth: true });
                        return;
                    }

                    if (
                        code &&
                        users[code]
                    ) {

                        users[code].name =
                            name;


                        if (
                            message.avatar !==
                            undefined
                        ) {

                            users[code].avatar =
                                String(
                                    message.avatar ||
                                        ""
                                )
                                    .slice(
                                        0,
                                        MAX_AVATAR_DATA
                                    );
                        }


                        if (!Array.isArray(users[code].friends)) users[code].friends = [];
                        if (users[code].rank === undefined) users[code].rank = getRank(code);
                        if (Array.isArray(message.friends)) {
                            message.friends.forEach(function(f){
                                const friendCode = cleanCode(typeof f === "string" ? f : f && f.code);
                                if (friendCode && !users[code].friends.includes(friendCode)) users[code].friends.push(friendCode);
                            });
                        }
                        // Merge locally cached requests with the server copy.
                        // Never replace the server copy with an empty/stale client copy,
                        // otherwise a pending request can disappear when the recipient reconnects.
                        if (!users[code].friendRequests || typeof users[code].friendRequests !== "object") {
                            users[code].friendRequests = { incoming: [], outgoing: [] };
                        }
                        if (message.friendRequests && typeof message.friendRequests === "object") {
                            const incoming = Array.isArray(users[code].friendRequests.incoming) ? users[code].friendRequests.incoming : [];
                            const outgoing = Array.isArray(users[code].friendRequests.outgoing) ? users[code].friendRequests.outgoing : [];
                            const clientIncoming = Array.isArray(message.friendRequests.incoming) ? message.friendRequests.incoming : [];
                            const clientOutgoing = Array.isArray(message.friendRequests.outgoing) ? message.friendRequests.outgoing : [];
                            const mergeRequests = function(serverList, clientList) {
                                const result = serverList.slice();
                                clientList.forEach(function(r) {
                                    const code = cleanCode(r && (r.code || r.from || r.to));
                                    if (!code) return;
                                    if (!result.some(function(x) { return cleanCode(x && (x.code || x.from || x.to)) === code; })) {
                                        result.push(r);
                                    }
                                });
                                return result;
                            };
                            users[code].friendRequests.incoming = mergeRequests(incoming, clientIncoming);
                            users[code].friendRequests.outgoing = mergeRequests(outgoing, clientOutgoing);
                        }


                        saveJSON(
                            USERS_FILE,
                            users
                        );

                    } else {

                        // Keep the user's existing device code stable. If the server
                        // lost its local data (for example after a fresh deployment),
                        // recreate the account under the code stored on the device.
                        code = code || generateCode();

                        users[code] = {

                            code,

                            name,

                            avatar:
                                String(
                                    message.avatar ||
                                        ""
                                )
                                    .slice(
                                        0,
                                        MAX_AVATAR_DATA
                                    ),

                            friends: Array.isArray(message.friends) ? message.friends.map(function(f){ return cleanCode(typeof f === "string" ? f : f && f.code); }).filter(Boolean) : [],

                            friendRequests: message.friendRequests && typeof message.friendRequests === "object" ? message.friendRequests : { incoming: [], outgoing: [] },
                            rank: "",

                            createdAt:
                                new Date()
                                    .toISOString()
                        };


                        saveJSON(
                            USERS_FILE,
                            users
                        );
                    }


                    clients.set(
                        ws,
                        {
                            code,
                            name: users[code].name,
                            active: false,
                            lastSeen: Date.now(),
                            typingTo: null
                        }
                    );


                    send(
                        ws,
                        {
                            type:
                                "registered",

                            code,

                            name:
                                users[code]
                                    .name,

                            avatar:
                                users[code]
                                    .avatar ||
                                "",

                            friends:
                                users[code].friends || [],
                            friendRequests:
                                users[code].friendRequests || { incoming: [], outgoing: [] },
                            rank: getRank(code),
                            serverVersion: "2026-09-16-v9"
                        }
                    );


                    // Deliver messages and pending friend requests after reconnect.
                    deliverPendingMessages(ws, code);
                    send(ws, {
                        type: "friend-requests-list",
                        incoming: (users[code].friendRequests && users[code].friendRequests.incoming) || [],
                        outgoing: (users[code].friendRequests && users[code].friendRequests.outgoing) || []
                    });

                    sendToUsers(users[code].friends || [], {
                        type: "presence",
                        code,
                        online: isUserActive(code),
                        lastSeen: users[code].lastSeen || null
                    }, code);


                    return;
                }


                /* =========================================
                   ACCOUNT AUTH
                ========================================= */

                if (message.type === "auth-register") {
                    const username = normalizeUsername(message.username);
                    const password = String(message.password || "");
                    const name = cleanName(message.name) || username;
                    if (username.length < 3) { sendError(ws, "Username must be at least 3 characters."); return; }
                    if (password.length < 6) { sendError(ws, "Password must be at least 6 characters."); return; }
                    if (authAccounts[username]) { sendError(ws, "That username is already taken."); return; }
                    const code = generateCode();
                    const pass = makePasswordRecord(password);
                    const authToken = crypto.randomBytes(32).toString("hex");
                    authAccounts[username] = { username, code, salt: pass.salt, passwordHash: pass.hash, authToken, createdAt: new Date().toISOString() };
                    users[code] = { code, name, avatar: "", friends: [], friendRequests: { incoming: [], outgoing: [] }, rank: "", createdAt: new Date().toISOString(), username };
                    saveJSON(AUTH_FILE, authAccounts); saveJSON(USERS_FILE, users);
                    send(ws, { type: "auth-success", account: publicAccount(authAccounts[username]), authToken, name, avatar: "" });
                    return;
                }

                if (message.type === "auth-login") {
                    const username = normalizeUsername(message.username);
                    const password = String(message.password || "");
                    const account = authAccounts[username];
                    if (!account) { sendError(ws, "Account not found.", { auth: true }); return; }
                    if (hashPassword(password, account.salt) !== account.passwordHash) { sendError(ws, "Incorrect password.", { auth: true }); return; }
                    const u = users[account.code] || {};
                    send(ws, { type: "auth-success", account: publicAccount(account), authToken: account.authToken, name: u.name || username, avatar: u.avatar || "" });
                    return;
                }

                /* =========================================
                   AUTHENTICATION
                ========================================= */

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


                /* =========================================
                   PROFILE
                ========================================= */

                if (
                    message.type ===
                    "update-profile"
                ) {

                    const name =
                        cleanName(
                            message.name
                        );


                    if (!name) {

                        sendError(
                            ws,
                            "Invalid display name."
                        );

                        return;
                    }


                    user.name =
                        name;


                    if (
                        message.avatar !==
                        undefined
                    ) {

                        const avatar = String(message.avatar || "");
                        if (avatar.length > MAX_AVATAR_DATA) {
                            sendError(ws, "Profile picture is too large. Maximum is 20 MB.");
                            return;
                        }
                        user.avatar = avatar;
                    }


                    info.name =
                        name;


                    saveJSON(
                        USERS_FILE,
                        users
                    );


                    send(
                        ws,
                        {
                            type:
                                "profile-updated",

                            code:
                                info.code,

                            name:
                                user.name,

                            avatar:
                                user.avatar ||
                                ""
                        }
                    );


                    sendToUsers(
                        user.friends ||
                            [],

                        {
                            type:
                                "friend-profile-updated",

                            code:
                                info.code,

                            name:
                                user.name,

                            avatar:
                                user.avatar ||
                                ""
                        },

                        info.code
                    );


                    return;
                }


                /* =========================================
                   LOOKUP USER
                ========================================= */

                if (
                    message.type ===
                    "lookup-user"
                ) {

                    const code =
                        cleanCode(
                            message.code
                        );


                    if (
                        !userExists(code)
                    ) {

                        sendError(
                            ws,
                            "User not found."
                        );

                        return;
                    }


                    send(
                        ws,
                        {
                            type:
                                "user-found",

                            user: {

                                code,

                                name:
                                    users[code]
                                        .name,

                                avatar:
                                    users[code]
                                        .avatar ||
                                    "",
                                rank: getRank(code)
                            },

                            online:
                                !!getClient(
                                    code
                                )
                        }
                    );


                    return;
                }


                /* =========================================
                   FRIEND REQUESTS
                ========================================= */

                if (message.type === "add-friend") {
                    const target = cleanCode(message.code);
                    if (!userExists(target) || target === info.code) { sendError(ws, "Invalid friend code."); return; }
                    if (Array.isArray(user.friends) && user.friends.includes(target)) { sendError(ws, "You are already friends."); return; }
                    if (!user.friendRequests || typeof user.friendRequests !== "object") user.friendRequests = { incoming: [], outgoing: [] };
                    if (!users[target].friendRequests || typeof users[target].friendRequests !== "object") users[target].friendRequests = { incoming: [], outgoing: [] };
                    user.friendRequests.outgoing = (user.friendRequests.outgoing || []).filter(r => (r.code || r.to) !== target);
                    users[target].friendRequests.incoming = (users[target].friendRequests.incoming || []).filter(r => (r.code || r.from) !== info.code);
                    user.friendRequests.outgoing.push({ code: target, name: users[target].name || "User" });
                    users[target].friendRequests.incoming.push({ code: info.code, name: user.name || "User", avatar: user.avatar || "", rank: getRank(info.code) });
                    saveJSON(USERS_FILE, users);

                    // Confirm the request to the sender and immediately deliver the
                    // complete incoming request list to the recipient. The full list
                    // is also persisted, so it remains available if the recipient is
                    // offline or reconnects later.
                    send(ws, {
                        type: "friend-request-sent",
                        to: target,
                        name: users[target].name || "User"
                    });
                    send(ws, {
                        type: "friend-requests-list",
                        incoming: user.friendRequests.incoming || [],
                        outgoing: user.friendRequests.outgoing || []
                    });

                    sendToUser(target, {
                        type: "friend-request",
                        from: info.code,
                        name: user.name || "User",
                        avatar: user.avatar || ""
                    });
                    sendToUser(target, {
                        type: "friend-requests-list",
                        incoming: users[target].friendRequests.incoming || [],
                        outgoing: users[target].friendRequests.outgoing || []
                    });
                    return;
                }

                if (message.type === "get-friend-requests") {
                    if (!user.friendRequests || typeof user.friendRequests !== "object") user.friendRequests = { incoming: [], outgoing: [] };
                    send(ws, { type: "friend-requests-list", incoming: user.friendRequests.incoming || [], outgoing: user.friendRequests.outgoing || [] });
                    return;
                }

                if (message.type === "accept-friend-request" || message.type === "decline-friend-request") {
                    const requester = cleanCode(message.code);
                    if (!userExists(requester) || !user.friendRequests) return;
                    const hasRequest = (user.friendRequests.incoming || []).some(r => (r.code || r.from) === requester);
                    if (!hasRequest) return;
                    user.friendRequests.incoming = (user.friendRequests.incoming || []).filter(r => (r.code || r.from) !== requester);
                    if (!users[requester].friendRequests || typeof users[requester].friendRequests !== "object") users[requester].friendRequests = { incoming: [], outgoing: [] };
                    users[requester].friendRequests.outgoing = (users[requester].friendRequests.outgoing || []).filter(r => (r.code || r.to) !== info.code);
                    if (message.type === "accept-friend-request") {
                        if (!Array.isArray(user.friends)) user.friends = [];
                        if (!Array.isArray(users[requester].friends)) users[requester].friends = [];
                        if (!user.friends.includes(requester)) user.friends.push(requester);
                        if (!users[requester].friends.includes(info.code)) users[requester].friends.push(info.code);
                        saveJSON(USERS_FILE, users);
                        send(ws, { type: "friend-request-accepted", code: requester });
                        sendToUser(requester, { type: "friend-request-accepted", code: info.code });
                        sendToUser(requester, { type: "friends-updated" });
                    } else {
                        saveJSON(USERS_FILE, users);
                        send(ws, { type: "friend-request-declined", code: requester });
                        sendToUser(requester, { type: "friend-request-declined", code: info.code });
                    }
                    return;
                }

                if (message.type === "remove-friend") {
                    const target = cleanCode(message.code);
                    if (!userExists(target) || target === info.code) return;
                    user.friends = Array.isArray(user.friends) ? user.friends.filter(c => c !== target) : [];
                    users[target].friends = Array.isArray(users[target].friends) ? users[target].friends.filter(c => c !== info.code) : [];
                    if (users[target].friendRequests) {
                        users[target].friendRequests.incoming = (users[target].friendRequests.incoming || []).filter(r => (r.code || r.from) !== info.code);
                        users[target].friendRequests.outgoing = (users[target].friendRequests.outgoing || []).filter(r => (r.code || r.to) !== info.code);
                    }
                    if (user.friendRequests) {
                        user.friendRequests.incoming = (user.friendRequests.incoming || []).filter(r => (r.code || r.from) !== target);
                        user.friendRequests.outgoing = (user.friendRequests.outgoing || []).filter(r => (r.code || r.to) !== target);
                    }
                    saveJSON(USERS_FILE, users);
                    send(ws, { type: "friends-updated" });
                    sendToUser(target, { type: "friend-removed", code: info.code });
                    return;
                }

                if (message.type === "app-state") {
                    const active = message.active === true;
                    const old = !!info.active;
                    info.active = active;
                    if (!active) {
                        info.lastSeen = Date.now();
                        user.lastSeen = new Date(info.lastSeen).toISOString();
                        saveJSON(USERS_FILE, users);
                    }
                    if (old !== active) broadcastPresence(info.code);
                    return;
                }

                if (message.type === "typing-start" || message.type === "typing-stop") {
                    const target = cleanCode(message.to);
                    if (!target || !userExists(target)) return;
                    sendToUser(target, { type: message.type === "typing-start" ? "typing" : "typing-stop", from: info.code, name: user.name });
                    return;
                }

                /* =========================================
                   GET FRIENDS
                ========================================= */

                if (
                    message.type ===
                    "get-friends"
                ) {

                    const result =
                        (
                            user.friends ||
                            []
                        )
                            .map(
                                code => {

                                    const friend =
                                        users[
                                            code
                                        ];


                                    if (
                                        !friend
                                    ) {
                                        return null;
                                    }


                                    return {

                                        code,

                                        name:
                                            friend.name,

                                        avatar:
                                            friend.avatar ||
                                            "",
                                        rank: getRank(code),

                                        online: isUserActive(code),
                                        lastSeen: friend.lastSeen || null
                                    };
                                }
                            )
                            .filter(
                                Boolean
                            );


                    send(
                        ws,
                        {
                            type:
                                "friends-list",

                            friends:
                                result
                        }
                    );


                    return;
                }


                /* =========================================
                   BLOCK / UNBLOCK
                ========================================= */

                if (message.type === "get-blocked") {
                    if (!Array.isArray(user.blocked)) user.blocked = [];
                    send(ws, { type: "blocked-list", users: user.blocked });
                    return;
                }

                if (message.type === "block-user" || message.type === "unblock-user") {
                    const target = cleanCode(message.code);
                    if (!userExists(target) || target === info.code) { sendError(ws, "Invalid user."); return; }
                    if (!Array.isArray(user.blocked)) user.blocked = [];
                    if (message.type === "block-user") {
                        if (!user.blocked.includes(target)) user.blocked.push(target);
                        sendToUser(target, { type: "user-blocked-by", code: info.code });
                    } else {
                        user.blocked = user.blocked.filter(x => x !== target);
                        sendToUser(target, { type: "user-unblocked-by", code: info.code });
                    }
                    saveJSON(USERS_FILE, users);
                    send(ws, { type: message.type === "block-user" ? "user-blocked" : "user-unblocked", code: target });
                    return;
                }

                /* =========================================
                   VIBES
                ========================================= */

                if (message.type === "get-vibes") {
                    send(ws, { type: "vibes-list", vibes: getVisibleVibes(info.code) });
                    return;
                }

                if (message.type === "set-vibe") {
                    cleanupVibes();
                    const text = cleanVibeText(message.text);
                    const image = cleanVibeImage(message.image);
                    const audio = String(message.audio || "").slice(0, 3 * 1024 * 1024);
                    if (!text && !image && !audio) { sendError(ws, "Add text, a photo, or audio to your Vibe."); return; }
                    if (image.length > VIBE_MAX_IMAGE_DATA) { sendError(ws, "Vibe photo is too large."); return; }
                    if (audio && !audio.startsWith("data:audio/")) { sendError(ws, "Invalid Vibe audio."); return; }
                    if (!Array.isArray(vibes[info.code])) vibes[info.code] = [];
                    const now = new Date();
                    const vibe = {
                        id: crypto.randomUUID(),
                        owner: info.code,
                        text,
                        image,
                        audio,
                        audioDuration: Math.max(0, Math.min(60, Number(message.audioDuration || 0))),
                        createdAt: now.toISOString(),
                        expiresAt: now.getTime() + VIBE_TTL_MS
                    };
                    vibes[info.code].push(vibe);
                    if (vibes[info.code].length > VIBE_MAX_PER_USER) {
                        vibes[info.code].splice(0, vibes[info.code].length - VIBE_MAX_PER_USER);
                    }
                    saveJSON(VIBES_FILE, vibes);
                    send(ws, { type: "vibe-saved", vibe: publicVibe(vibe, users[info.code]) });
                    send(ws, { type: "vibes-list", vibes: getVisibleVibes(info.code) });
                    return;
                }

                if (message.type === "delete-vibe") {
                    const id = String(message.id || "");
                    const list = Array.isArray(vibes[info.code]) ? vibes[info.code] : [];
                    const next = list.filter(v => v.id !== id);
                    if (next.length !== list.length) {
                        vibes[info.code] = next;
                        if (!next.length) delete vibes[info.code];
                        saveJSON(VIBES_FILE, vibes);
                    }
                    send(ws, { type: "vibes-list", vibes: getVisibleVibes(info.code) });
                    return;
                }

                if (message.type === "view-vibe") {
                    const id = String(message.id || "");
                    const ownerCode = cleanCode(message.owner);
                    if (ownerCode && Array.isArray(vibes[ownerCode])) {
                        const found = vibes[ownerCode].find(v => v.id === id);
                        if (found) {
                            if (!Array.isArray(found.seenBy)) found.seenBy = [];
                            if (!found.seenBy.includes(info.code)) { found.seenBy.push(info.code); saveJSON(VIBES_FILE, vibes); }
                        }
                    }
                    return;
                }


/* =========================================
                   MESSAGE DELIVERY ACK
                ========================================= */

                if (message.type === "message-received") {
                    const messageId = String(message.messageId || "").slice(0, 100);
                    const messageType = message.messageType === "group-chat" ? "group-chat" : "private-chat";
                    const groupId = String(message.groupId || "").trim();

                    if (!messageId) return;
                    acknowledgeDeliveredMessage(info.code, messageId, messageType, groupId);
                    return;
                }


                /* =========================================
                   PRIVATE CHAT
                ========================================= */

                if (message.type === "voice-message") {
                    const to = cleanCode(message.to);
                    const data = String(message.data || "");
                    if (!to || !userExists(to) || !data.startsWith("data:audio/")) return;
                    const comma = data.indexOf(",");
                    if (comma < 0) return;
                    const meta = data.slice(5, comma);
                    const b64 = data.slice(comma + 1);
                    const buffer = Buffer.from(b64, "base64");
                    if (buffer.length > MAX_VOICE_BYTES) { sendError(ws, "Voice message is too large. Maximum is 2 MB."); return; }
                    const mime = (meta.split(";")[0] || "audio/webm").toLowerCase();
                    const ext = mime.includes("ogg") ? ".ogg" : mime.includes("mp4") || mime.includes("m4a") ? ".m4a" : mime.includes("wav") ? ".wav" : ".webm";
                    const fileName = crypto.randomBytes(18).toString("hex") + ext;
                    fs.writeFileSync(path.join(VOICE_DIR, fileName), buffer);
                    const packet = { type: "private-chat", messageId: crypto.randomUUID(), from: info.code, to, sender: user.name, avatar: user.avatar || "", text: "", voice: `/voice/${fileName}`, voiceDuration: Math.max(0, Math.min(60, Number(message.duration || 0))), time: new Date().toISOString() };
                    rememberPrivateMessage(packet);
                    queuePrivateMessage(to, packet);
                    sendToUser(to, packet);
                    send(ws, packet);
                    return;
                }

                if (
                    message.type ===
                    "private-chat"
                ) {

                    const to =
                        cleanCode(
                            message.to
                        );


                    const text =
                        cleanText(
                            message.text
                        );

                    const image =
                        message.image
                            ? String(message.image).slice(0, MAX_IMAGE_DATA)
                            : "";


                    if (
                        !userExists(to)
                    ) {

                        sendError(
                            ws,
                            "User not found."
                        );

                        return;
                    }


                    if (
                        !text.trim() && !image
                    ) {
                        return;
                    }


                    const messageId =
                        String(message.messageId || crypto.randomUUID()).slice(0, 100);

                    let packet;
                    const existing = messageHistory[messageId];

                    // Idempotency: reconnecting clients can retry the same
                    // messageId without creating duplicate messages.
                    if (existing) {
                        if (existing.from !== info.code || existing.to !== to) {
                            sendError(ws, "Invalid message ID.");
                            return;
                        }

                        packet = {
                            type: "private-chat",
                            from: existing.from,
                            to: existing.to,
                            sender: existing.sender || user.name,
                            avatar: existing.avatar || user.avatar || "",
                            rank: getRank(existing.from),
                            text: existing.text || "",
                            image: existing.image || image,
                            messageId: existing.messageId,
                            time: existing.time
                        };
                    } else {
                        packet = {
                            type: "private-chat",
                            from: info.code,
                            to,
                            sender: user.name,
                            avatar: user.avatar || "",
                            rank: getRank(info.code),
                            text,
                            image,
                            messageId,
                            time: new Date().toISOString()
                        };

                        rememberPrivateMessage(packet);
                    }

                    // ALWAYS persist the recipient delivery before sending.
                    // This closes the race where a stale/half-dead recipient
                    // socket looks OPEN but loses the packet. The queue is
                    // removed only after the recipient sends message-received.
                    queuePrivateMessage(to, packet);
                    sendToUser(to, packet);

                    // Authoritative echo tells the sender that the server
                    // accepted this messageId. The recipient ACK is what
                    // clears the server delivery queue.
                    send(ws, packet);

                    return;
                }


                /* =========================================
                   CLIENT HEARTBEAT
                ========================================= */

                if (message.type === "ping") {
                    send(ws, { type: "pong" });
                    return;
                }

                /* =========================================
                   TYPING INDICATOR
                ========================================= */

                if (message.type === "typing") {
                    const to = cleanCode(message.to);
                    if (!userExists(to) || isBlocked(info.code, to) || isBlocked(to, info.code)) return;
                    sendToUser(to, { type: "typing", from: info.code, sender: user.name, isTyping: !!message.isTyping });
                    return;
                }

                /* =========================================
                   OWNER RANK CONTROL
                ========================================= */

                if (message.type === "owner-set-rank") {
                    const targetCode =
                        cleanCode(message.targetCode || message.code);
                    const requestedRank =
                        normalizeRank(message.rank);
                    const password =
                        String(message.password || "");

                    if (password !== OWNER_PASSWORD) {
                        sendError(ws, "Owner authorization failed.", {
                            actionType: "owner-set-rank"
                        });
                        return;
                    }

                    if (!userExists(targetCode)) {
                        sendError(ws, "Target user not found.", {
                            actionType: "owner-set-rank"
                        });
                        return;
                    }

                    // Do not allow the existing owner to accidentally
                    // remove their own Owner rank.
                    if (targetCode === info.code &&
                        getRank(info.code) === "owner" &&
                        requestedRank !== "owner") {
                        sendError(ws, "The Owner rank cannot be removed here.", {
                            actionType: "owner-set-rank"
                        });
                        return;
                    }

                    setRank(targetCode, requestedRank);

                    const event = {
                        type: "rank-updated",
                        code: targetCode,
                        rank: requestedRank,
                        changedBy: info.code
                    };

                    sendToUser(targetCode, event);
                    if (targetCode !== info.code) {
                        sendToUser(info.code, event);
                    }

                    const targetUser = users[targetCode];
                    sendToUsers(
                        targetUser.friends || [],
                        event
                    );

                    send(ws, {
                        type: "rank-action-ack",
                        code: targetCode,
                        rank: requestedRank
                    });

                    return;
                }

                /* =========================================
                   CREATE GROUP
                ========================================= */

                if (
                    message.type ===
                    "create-group"
                ) {

                    const groupName =
                        cleanName(
                            message.name
                        );


                    if (!groupName) {

                        sendError(
                            ws,
                            "Enter a group name."
                        );

                        return;
                    }


                    const groupId =
                        generateGroupId();


                    groups[groupId] = {

                        id:
                            groupId,

                        name:
                            groupName,

                        owner:
                            info.code,

                        members: [
                            info.code
                        ],

                        createdAt:
                            new Date()
                                .toISOString()
                    };


                    saveJSON(
                        GROUPS_FILE,
                        groups
                    );


                    send(
                        ws,
                        {
                            type:
                                "group-created",

                            group:
                                groups[
                                    groupId
                                ]
                        }
                    );


                    return;
                }


                /* =========================================
                   JOIN GROUP
                ========================================= */

                if (
                    message.type ===
                    "join-group"
                ) {

                    const groupId =
                        String(
                            message.groupId ||
                                ""
                        ).trim();


                    const group =
                        groups[
                            groupId
                        ];


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
                    }


                    saveJSON(
                        GROUPS_FILE,
                        groups
                    );


                    send(
                        ws,
                        {
                            type:
                                "group-joined",

                            group
                        }
                    );


                    sendToGroup(
                        groupId,
                        {
                            type:
                                "group-member-joined",

                            groupId,

                            code:
                                info.code,

                            name:
                                user.name
                        },
                        info.code
                    );


                    return;
                }


                /* =========================================
                   GET GROUPS
                ========================================= */

                if (
                    message.type ===
                    "get-groups"
                ) {

                    const result =
                        Object
                            .values(groups)
                            .filter(
                                group =>
                                    Array.isArray(
                                        group.members
                                    ) &&
                                    group.members.includes(
                                        info.code
                                    )
                            );


                    send(
                        ws,
                        {
                            type:
                                "groups-list",

                            groups:
                                result
                        }
                    );


                    return;
                }


                /* =========================================
                   GROUP CHAT
                ========================================= */

                if (
                    message.type ===
                    "group-chat"
                ) {

                    const groupId =
                        String(
                            message.groupId ||
                                ""
                        ).trim();


                    const group =
                        groups[
                            groupId
                        ];


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
                        cleanText(
                            message.text
                        );


                    if (!text.trim()) {
                        return;
                    }


                    const packet = {

                        type:
                            "group-chat",

                        groupId,

                        from:
                            info.code,

                        sender:
                            user.name,

                        avatar:
                            user.avatar ||
                            "",
                        rank: getRank(info.code),

                        text,
                        messageId: String(message.messageId || crypto.randomUUID()).slice(0, 100),

                        time:
                            new Date()
                                .toISOString()
                    };


                    // Queue the group message separately for every recipient
                    // and keep it there until that recipient ACKs it. This gives
                    // group chats the same reliable delivery behavior as private chats.
                    for (const memberCode of group.members || []) {
                        if (memberCode === info.code) continue;
                        queuePrivateMessage(memberCode, packet);
                        sendToUser(memberCode, packet);
                    }

                    // Sender gets the authoritative echo.
                    send(ws, packet);


                    return;
                }


                /* =========================================
                   WEBRTC SIGNALING
                ========================================= */

                const signalTypes = [

                    "call",

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

                    /*
                     * GROUP SIGNALING
                     */

                    if (
                        message.groupId &&
                        groups[
                            message.groupId
                        ]
                    ) {

                        const group =
                            groups[
                                message.groupId
                            ];


                        if (
                            !group.members.includes(
                                info.code
                            )
                        ) {
                            return;
                        }


                        sendToGroup(
                            message.groupId,

                            {
                                ...message,

                                from:
                                    info.code,

                                sender:
                                    user.name
                            },

                            info.code
                        );


                        return;
                    }


                    /*
                     * PRIVATE SIGNALING
                     */

                    const to =
                        cleanCode(
                            message.to
                        );


                    if (
                        to &&
                        userExists(to)
                    ) {

                        sendToUser(
                            to,

                            {
                                ...message,

                                from:
                                    info.code,

                                sender:
                                    user.name
                            }
                        );
                    }


                    return;
                }


                /* =========================================
                   PING
                ========================================= */

                if (
                    message.type ===
                    "ping"
                ) {

                    send(
                        ws,
                        {
                            type:
                                "pong"
                        }
                    );

                    return;
                }


                sendError(
                    ws,
                    "Unknown message type: " +
                    message.type
                );
            }
        );


        /* ===============================================
           CLOSE
        =============================================== */

        ws.on(
            "close",
            (code, reason) => {

                console.log("WebSocket closed", code, reason ? reason.toString() : "");
                const info =
                    clients.get(ws);


                if (info) {
                    clients.delete(ws);

                    const user = users[info.code];
                    if (user && !isUserActive(info.code)) {
                        user.lastSeen = new Date().toISOString();
                        saveJSON(USERS_FILE, users);
                        broadcastPresence(info.code);
                    }
                }
            }
        );
    }
);


/* =====================================================
   HEARTBEAT
===================================================== */

const heartbeat =
    setInterval(
        () => {

            for (
                const ws of
                wss.clients
            ) {

                if (
                    ws.isAlive ===
                    false
                ) {

                    ws.terminate();

                    continue;
                }


                ws.isAlive =
                    false;


                try {

                    ws.ping();

                } catch {}
            }

        },
        25000
    );


wss.on(
    "close",
    () => {
        clearInterval(
            heartbeat
        );
    }
);


/* =====================================================
   START
===================================================== */

server.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `VedChat server running on port ${PORT}`
        );

        console.log(
            `Users: ${
                Object.keys(users).length
            }`
        );

        console.log(
            `Groups: ${
                Object.keys(groups).length
            }`
        );
    }
);