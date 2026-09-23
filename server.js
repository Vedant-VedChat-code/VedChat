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

const CHAT_HISTORY_FILE =
    path.join(__dirname, "chat_history.json");

// Legacy filename kept only for one-time migration from older VedChat builds.
const LEGACY_MESSAGE_HISTORY_FILE =
    path.join(__dirname, "message_history.json");

const RANKS_FILE =
    path.join(__dirname, "ranks.json");

const OWNER_PASSWORD =
    String(process.env.VEDCHAT_OWNER_PASSWORD || "111014");

const VALID_RANKS =
    new Set(["owner", "admin", ""]);


let users = {};
let groups = {};
let chatHistory = {};
let ranks = {};


const clients = new Map();


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
// Load the new server-side chat history. If an older deployment has
// message_history.json, migrate it automatically without requiring manual work.
const legacyChatHistory = loadJSON(LEGACY_MESSAGE_HISTORY_FILE, {});
chatHistory = loadJSON(
    CHAT_HISTORY_FILE,
    legacyChatHistory
);

if (
    !fs.existsSync(CHAT_HISTORY_FILE) &&
    legacyChatHistory &&
    Object.keys(legacyChatHistory).length
) {
    saveJSON(CHAT_HISTORY_FILE, legacyChatHistory);
}

ranks = loadJSON(RANKS_FILE, {});


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

function isBlocked(a, b) {
    a = cleanCode(a);
    b = cleanCode(b);

    if (!a || !b) return false;

    const user = users[a];
    return !!(
        user &&
        Array.isArray(user.blocked) &&
        user.blocked.includes(b)
    );
}


/* =====================================================
   SERVER-SIDE PRIVATE CHAT HISTORY / EDIT / DELETE SUPPORT
===================================================== */

function saveChatHistory() {
    saveJSON(CHAT_HISTORY_FILE, chatHistory);
}

function rememberPrivateMessage(packet) {
    if (!packet || !packet.messageId) return;

    chatHistory[packet.messageId] = {
        messageId: packet.messageId,
        from: packet.from,
        to: packet.to,
        text: packet.text || "",
        // Keep the image so previously sent image messages can be restored
        // after a refresh. The server is now the source of truth, not
        // browser localStorage.
        image: packet.image || "",
        sender: packet.sender || "",
        avatar: packet.avatar || "",
        time: packet.time || new Date().toISOString(),
        edited: !!packet.edited,
        deleted: !!packet.deleted
    };

    // Keep the JSON database bounded. The old code could accidentally delete
    // the wrong range once the limit was crossed.
    const keys = Object.keys(chatHistory);
    const MAX_HISTORY_RECORDS = 2000;

    if (keys.length > MAX_HISTORY_RECORDS) {
        keys
            .slice(0, keys.length - MAX_HISTORY_RECORDS)
            .forEach(k => delete chatHistory[k]);
    }

    saveChatHistory();
}

function getMessageRecord(messageId, from, to) {
    const record = chatHistory[messageId];
    if (!record) return null;
    if (record.from !== from || record.to !== to) return null;
    return record;
}

function getPrivateConversationHistory(a, b, limit = 1000) {
    a = cleanCode(a);
    b = cleanCode(b);

    if (!a || !b) return [];

    return Object.values(chatHistory)
        .filter(item =>
            item &&
            (
                (item.from === a && item.to === b) ||
                (item.from === b && item.to === a)
            )
        )
        .sort(
            (x, y) =>
                new Date(x.time || 0).getTime() -
                new Date(y.time || 0).getTime()
        )
        .slice(-Math.max(1, Math.min(Number(limit) || 1000, 1000)))
        .map(item => ({
            type: "private-chat",
            from: item.from,
            to: item.to,
            sender: item.sender || "",
            avatar: item.avatar || "",
            rank: getRank(item.from),
            text: item.text || "",
            image: item.image || "",
            messageId: item.messageId,
            time: item.time,
            edited: !!item.edited,
            deleted: !!item.deleted
        }));
}

function getPrivateHistoryIndex(code) {
    code = cleanCode(code);
    const latest = {};

    Object.values(chatHistory).forEach(item => {
        if (!item) return;

        let other = "";
        if (item.from === code) other = item.to;
        else if (item.to === code) other = item.from;
        else return;

        if (!other) return;

        const previous = latest[other];
        if (
            !previous ||
            new Date(item.time || 0).getTime() >
                new Date(previous.time || 0).getTime()
        ) {
            // Do not send a large image just to build the Recent Chats list.
            latest[other] = {
                type: "private-chat",
                from: item.from,
                to: item.to,
                sender: item.sender || "",
                avatar: item.avatar || "",
                rank: getRank(item.from),
                text: item.text || "",
                image: "",
                messageId: item.messageId,
                time: item.time,
                edited: !!item.edited,
                deleted: !!item.deleted
            };
        }
    });

    return latest;
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
                    version: "2026-09-17-v10-reliable"
                }));
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
                            name:
                                users[code]
                                    .name
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

                    sendToUsers(
                        users[code]
                            .friends ||
                            [],

                        {
                            type:
                                "presence",

                            code,

                            online: true
                        },

                        code
                    );


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

                                        online:
                                            !!getClient(
                                                code
                                            )
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
                   PRIVATE CHAT HISTORY
                ========================================= */

                if (message.type === "get-private-history") {
                    const other = cleanCode(message.code || message.to);

                    if (!other || !userExists(other) || other === info.code) {
                        sendError(ws, "Invalid chat user.");
                        return;
                    }

                    if (
                        isBlocked(info.code, other) ||
                        isBlocked(other, info.code)
                    ) {
                        send(ws, {
                            type: "private-history",
                            code: other,
                            messages: []
                        });
                        return;
                    }

                    send(ws, {
                        type: "private-history",
                        code: other,
                        messages: getPrivateConversationHistory(
                            info.code,
                            other,
                            message.limit || 1000
                        )
                    });

                    return;
                }

                if (message.type === "get-private-history-index") {
                    send(ws, {
                        type: "private-history-index",
                        chats: getPrivateHistoryIndex(info.code)
                    });
                    return;
                }


                /* =========================================
                   PRIVATE CHAT
                ========================================= */

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
                    const existing = chatHistory[messageId];

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
                    // Only announce offline when this was the user's last
                    // active connection. The Android background receiver and
                    // WebView can legitimately have two connections.
                    if (user && !getClient(info.code)) {
                        sendToUsers(
                            user.friends || [],
                            {
                                type: "presence",
                                code: info.code,
                                online: false
                            },
                            info.code
                        );
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