const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

let firebaseAdmin = null;
try {
    firebaseAdmin = require("firebase-admin");
} catch (error) {
    console.warn("firebase-admin is not installed; background push is disabled.");
}

const PORT = process.env.PORT || 8080;

const PUBLIC_DIR =
    path.join(__dirname, "public");

const USERS_FILE =
    path.join(__dirname, "users.json");

const GROUPS_FILE =
    path.join(__dirname, "groups.json");

const PENDING_MESSAGES_FILE =
    path.join(__dirname, "pending_messages.json");

const PUSH_TOKENS_FILE =
    path.join(__dirname, "push_tokens.json");


let users = {};
let groups = {};
let pushTokens = {};


const clients = new Map();


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

pushTokens =
    loadJSON(
        PUSH_TOKENS_FILE,
        {}
    );


/* =====================================================
   FIREBASE CLOUD MESSAGING
===================================================== */

function initializeFirebasePush() {
    if (!firebaseAdmin) return false;
    if (firebaseAdmin.apps && firebaseAdmin.apps.length) return true;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
        console.warn("FIREBASE_SERVICE_ACCOUNT_JSON is not set; background push is disabled.");
        return false;
    }

    try {
        const serviceAccount = JSON.parse(raw);
        firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount)
        });
        console.log("Firebase Cloud Messaging enabled.");
        return true;
    } catch (error) {
        console.error("Firebase initialization failed:", error.message);
        return false;
    }
}

async function sendPush(code, title, body, extra = {}) {
    if (!initializeFirebasePush()) return;
    const tokens = Array.isArray(pushTokens[code]) ? pushTokens[code] : [];
    if (!tokens.length) return;

    const data = {
        title: String(title || "VedChat").slice(0, 100),
        body: String(body || "New VedChat message").slice(0, 500),
        type: String(extra.type || "message"),
        from: String(extra.from || ""),
        groupId: String(extra.groupId || "")
    };

    try {
        const result = await firebaseAdmin.messaging().sendEachForMulticast({
            tokens,
            data,
            android: {
                priority: "high"
            }
        });

        const invalid = [];
        result.responses.forEach((response, index) => {
            if (!response.success) {
                const codeName = response.error && response.error.code;
                if (codeName === "messaging/registration-token-not-registered" || codeName === "messaging/invalid-registration-token") {
                    invalid.push(tokens[index]);
                }
            }
        });

        if (invalid.length) {
            pushTokens[code] = tokens.filter(t => !invalid.includes(t));
            saveJSON(PUSH_TOKENS_FILE, pushTokens);
        }
    } catch (error) {
        console.error("Push send failed:", error.message);
    }
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


function cleanImage(image) {
    const value = String(image || "");
    if (!value) return "";
    if (value.length > 1800000) return "";
    if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(value)) return "";
    return value;
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
    message
) {

    send(
        ws,
        {
            type: "error",
            message
        }
    );
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

    const ws =
        getClient(code);

    if (ws) {
        send(ws, data);
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

    pendingMessages[code].push(packet);

    if (pendingMessages[code].length > 1000) {
        pendingMessages[code].splice(
            0,
            pendingMessages[code].length - 1000
        );
    }

    savePendingMessages();
}

function deliverPendingMessages(ws, code) {
    const queue = pendingMessages[code];

    if (!Array.isArray(queue) || queue.length === 0) {
        return;
    }

    for (const packet of queue) {
        send(ws, packet);
    }

    delete pendingMessages[code];
    savePendingMessages();

    console.log(
        `Delivered ${queue.length} pending message(s) to ${code}`
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
        server
    });


/* =====================================================
   CONNECTION
===================================================== */

wss.on(
    "connection",
    ws => {

        ws.isAlive = true;


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
                                        1000000
                                    );
                        }


                        if (
                            !Array.isArray(
                                users[code].friends
                            )
                        ) {

                            users[code].friends =
                                [];
                        }


                        saveJSON(
                            USERS_FILE,
                            users
                        );

                    } else {

                        code =
                            generateCode();


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
                                        1000000
                                    ),

                            friends: [],

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
                                users[code]
                                    .friends ||
                                []
                        }
                    );


                    // Deliver messages sent while this user was offline.
                    deliverPendingMessages(ws, code);

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
                   PUSH TOKEN
                ========================================= */

                if (
                    message.type ===
                    "push-token"
                ) {
                    const token = String(message.token || "").trim();
                    if (!token || token.length > 4096) return;

                    if (!Array.isArray(pushTokens[info.code])) {
                        pushTokens[info.code] = [];
                    }

                    if (!pushTokens[info.code].includes(token)) {
                        pushTokens[info.code].push(token);
                    }

                    if (pushTokens[info.code].length > 5) {
                        pushTokens[info.code] = pushTokens[info.code].slice(-5);
                    }

                    saveJSON(PUSH_TOKENS_FILE, pushTokens);
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

                        user.avatar =
                            String(
                                message.avatar ||
                                    ""
                            )
                                .slice(
                                    0,
                                    1000000
                                );
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
                                    ""
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
                   ADD FRIEND
                ========================================= */

                if (
                    message.type ===
                    "add-friend"
                ) {

                    const friendCode =
                        cleanCode(
                            message.code
                        );


                    if (
                        !userExists(
                            friendCode
                        )
                    ) {

                        sendError(
                            ws,
                            "Friend code not found."
                        );

                        return;
                    }


                    if (
                        friendCode ===
                        info.code
                    ) {

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

                        user.friends =
                            [];
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
                            users[
                                friendCode
                            ].friends
                        )
                    ) {

                        users[
                            friendCode
                        ].friends =
                            [];
                    }


                    if (
                        !users[
                            friendCode
                        ]
                            .friends
                            .includes(
                                info.code
                            )
                    ) {

                        users[
                            friendCode
                        ]
                            .friends
                            .push(
                                info.code
                            );
                    }


                    saveJSON(
                        USERS_FILE,
                        users
                    );


                    send(
                        ws,
                        {
                            type:
                                "friends-updated",

                            friends:
                                user.friends
                        }
                    );


                    sendToUser(
                        friendCode,
                        {
                            type:
                                "friend-added",

                            code:
                                info.code
                        }
                    );


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
                        cleanImage(
                            message.image
                        );

                    if (!text.trim() && !image) {
                        return;
                    }

                    const packet = {
                        type: "private-chat",
                        id: cleanText(message.id).slice(0, 100),
                        from: info.code,
                        to,
                        sender: user.name,
                        avatar: user.avatar || "",
                        text,
                        image,
                        time: new Date().toISOString()
                    };


                    /*
                     * Send to recipient if online. Otherwise queue the
                     * message on disk for delivery on reconnect.
                     */

                    const recipientSocket =
                        getClient(to);

                    if (recipientSocket) {
                        send(
                            recipientSocket,
                            packet
                        );
                    } else {
                        queuePrivateMessage(
                            to,
                            packet
                        );

                        sendPush(
                            to,
                            user.name || "VedChat",
                            image ? "📷 Sent you an image" : (text || "New VedChat message"),
                            { type: "private-chat", from: info.code }
                        );
                    }


                    /*
                     * Echo exactly once to sender.
                     */

                    send(
                        ws,
                        packet
                    );


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

                    const image =
                        cleanImage(
                            message.image
                        );

                    if (!text.trim() && !image) {
                        return;
                    }

                    const packet = {
                        type: "group-chat",
                        groupId,
                        from: info.code,
                        sender: user.name,
                        avatar: user.avatar || "",
                        text,
                        image,
                        time: new Date().toISOString()
                    };


                    /*
                     * Send to everyone except
                     * sender.
                     */

                    sendToGroup(
                        groupId,
                        packet,
                        info.code
                    );

                    for (const memberCode of group.members || []) {
                        if (memberCode === info.code) continue;
                        if (!getClient(memberCode)) {
                            sendPush(
                                memberCode,
                                group.name || "VedChat group",
                                image ? `📷 ${user.name} sent an image` : `${user.name}: ${text}` ,
                                { type: "group-chat", from: info.code, groupId }
                            );
                        }
                    }


                    /*
                     * Then send exactly once
                     * to sender.
                     */

                    send(
                        ws,
                        packet
                    );


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
            () => {

                const info =
                    clients.get(ws);


                if (info) {

                    const user =
                        users[
                            info.code
                        ];


                    if (user) {

                        sendToUsers(
                            user.friends ||
                                [],

                            {
                                type:
                                    "presence",

                                code:
                                    info.code,

                                online:
                                    false
                            },

                            info.code
                        );
                    }
                }


                clients.delete(ws);
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
        30000
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