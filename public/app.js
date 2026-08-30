/* =====================================================
   VEDCHAT V2
===================================================== */

let ws = null;

let connectionState = "offline";

let myCode =
    localStorage.getItem("vedchat_code") || "";

let myName =
    localStorage.getItem("vedchat_name") || "";

let myAvatar =
    localStorage.getItem("vedchat_avatar") || "";

let currentPage = "home";

let currentFriend = null;
let currentGroup = null;

let friends = [];
let groups = [];

let privateMessages =
    JSON.parse(
        localStorage.getItem(
            "vedchat_private_messages"
        ) || "{}"
    );

let groupMessages =
    JSON.parse(
        localStorage.getItem(
            "vedchat_group_messages"
        ) || "{}"
    );

let callHistory =
    JSON.parse(
        localStorage.getItem(
            "vedchat_call_history"
        ) || "[]"
    );

let peerConnections = {};
let localStream = null;

let incomingCall = null;

let reconnectTimer = null;

/* =====================================================
   HELPERS
===================================================== */

function escapeHTML(value) {

    const div =
        document.createElement("div");

    div.textContent =
        String(value ?? "");

    return div.innerHTML;
}

function saveLocal() {

    localStorage.setItem(
        "vedchat_private_messages",
        JSON.stringify(privateMessages)
    );

    localStorage.setItem(
        "vedchat_group_messages",
        JSON.stringify(groupMessages)
    );

    localStorage.setItem(
        "vedchat_call_history",
        JSON.stringify(callHistory)
    );
}

function avatarHTML(
    avatar,
    name,
    size = 50
) {

    if (avatar) {

        return `
            <img
                src="${escapeHTML(avatar)}"
                class="avatar-img"
                style="
                    width:${size}px;
                    height:${size}px;
                "
            >
        `;
    }

    return `
        <div
            class="avatar"
            style="
                width:${size}px;
                height:${size}px;
            "
        >
            ${escapeHTML(
                String(name || "U")
                    .charAt(0)
                    .toUpperCase()
            )}
        </div>
    `;
}

/* =====================================================
   WEBSOCKET URL
===================================================== */

function websocketURL() {

    if (
        location.protocol ===
        "https:"
    ) {
        return (
            "wss://" +
            location.host
        );
    }

    return (
        "ws://" +
        location.host
    );
}

/* =====================================================
   CONNECT
===================================================== */

function connectServer() {

    if (
        ws &&
        (
            ws.readyState ===
                WebSocket.OPEN ||
            ws.readyState ===
                WebSocket.CONNECTING
        )
    ) {
        return;
    }

    connectionState =
        "connecting";

    updateStatus();

    try {

        ws =
            new WebSocket(
                websocketURL()
            );

    } catch (error) {

        console.error(error);

        scheduleReconnect();

        return;
    }

    ws.onopen = () => {

        connectionState =
            "connected";

        updateStatus();

        /*
         * Register existing account.
         */

        if (myName) {

            sendRaw({
                type: "register",
                code: myCode,
                name: myName,
                avatar: myAvatar
            });
        }
    };

    ws.onclose = () => {

        connectionState =
            "offline";

        updateStatus();

        scheduleReconnect();
    };

    ws.onerror = error => {

        console.error(
            "WebSocket error:",
            error
        );
    };

    ws.onmessage = event => {

        try {

            const message =
                JSON.parse(
                    event.data
                );

            handleMessage(
                message
            );

        } catch (error) {

            console.error(
                "Message error:",
                error
            );
        }
    };
}

function scheduleReconnect() {

    if (reconnectTimer) return;

    reconnectTimer =
        setTimeout(() => {

            reconnectTimer = null;

            connectServer();

        }, 3000);
}

function sendRaw(data) {

    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {

        ws.send(
            JSON.stringify(data)
        );

        return true;
    }

    return false;
}

function send(data) {

    if (!sendRaw(data)) {

        alert(
            "VedChat is not connected."
        );

        return false;
    }

    return true;
}

/* =====================================================
   SERVER MESSAGES
===================================================== */

function handleMessage(message) {

    switch (message.type) {

        case "server-ready":
            break;

        case "registered":

            myCode =
                message.code;

            myName =
                message.name;

            myAvatar =
                message.avatar || "";

            localStorage.setItem(
                "vedchat_code",
                myCode
            );

            localStorage.setItem(
                "vedchat_name",
                myName
            );

            localStorage.setItem(
                "vedchat_avatar",
                myAvatar
            );

            if (
                currentPage ===
                "home"
            ) {
                showHome();
            }

            getFriends();
            getGroups();

            break;

        case "profile-updated":

            myName =
                message.name;

            myAvatar =
                message.avatar || "";

            localStorage.setItem(
                "vedchat_name",
                myName
            );

            localStorage.setItem(
                "vedchat_avatar",
                myAvatar
            );

            showProfile();

            break;

        case "friends-list":

            friends =
                message.friends || [];

            if (
                currentPage ===
                "friends"
            ) {
                showFriends();
            }

            break;

        case "friends-updated":

            getFriends();

            break;

        case "friend-added":

            getFriends();

            break;

        case "presence":

            friends =
                friends.map(friend => {

                    if (
                        friend.code ===
                        message.code
                    ) {

                        return {
                            ...friend,
                            online:
                                message.online
                        };
                    }

                    return friend;
                });

            if (
                currentPage ===
                "friends"
            ) {
                showFriends();
            }

            break;

        case "user-found":

            showFoundUser(
                message.user,
                message.online
            );

            break;

        case "private-chat":

            receivePrivateMessage(
                message
            );

            break;

        case "groups-list":

            groups =
                message.groups || [];

            if (
                currentPage ===
                "groups"
            ) {
                showGroups();
            }

            break;

        case "group-created":

            groups.push(
                message.group
            );

            showGroups();

            break;

        case "group-joined":

            if (
                !groups.some(
                    group =>
                        group.id ===
                        message.group.id
                )
            ) {

                groups.push(
                    message.group
                );
            }

            showGroups();

            break;

        case "group-chat":

            receiveGroupMessage(
                message
            );

            break;

        case "group-member-joined":

            break;

        case "call":

            if (
                message.action ===
                "offer"
            ) {

                receiveIncomingCall(
                    message
                );
            }

            break;

        case "call-offer":

            receiveIncomingCall(
                message
            );

            break;

        case "call-answer":

            handleCallAnswer(
                message
            );

            break;

        case "ice-candidate":

            handleIceCandidate(
                message
            );

            break;

        case "call-decline":

            finishCallHistory(
                "Declined"
            );

            break;

        case "call-end":

            endAllCallConnections();

            break;

        case "error":

            alert(
                message.message
            );

            break;
    }
}

/* =====================================================
   PROFILE / ACCOUNT
===================================================== */

function createAccountIfNeeded() {

    if (myName) return;

    const name =
        prompt(
            "Choose your VedChat display name:"
        );

    myName =
        name && name.trim()
            ? name.trim()
            : "Guest";

    localStorage.setItem(
        "vedchat_name",
        myName
    );
}

function editProfile() {

    const name =
        prompt(
            "Display name:",
            myName
        );

    if (
        !name ||
        !name.trim()
    ) {
        return;
    }

    send({
        type: "update-profile",
        name: name.trim(),
        avatar: myAvatar
    });
}

function chooseAvatar() {

    const input =
        document.createElement(
            "input"
        );

    input.type = "file";
    input.accept =
        "image/png,image/jpeg,image/webp";

    input.onchange =
        event => {

            const file =
                event.target.files[0];

            if (!file) return;

            if (
                file.size >
                1024 * 1024
            ) {

                alert(
                    "Please choose an image smaller than 1 MB."
                );

                return;
            }

            const reader =
                new FileReader();

            reader.onload =
                () => {

                    myAvatar =
                        reader.result;

                    localStorage.setItem(
                        "vedchat_avatar",
                        myAvatar
                    );

                    send({
                        type:
                            "update-profile",
                        name:
                            myName,
                        avatar:
                            myAvatar
                    });
                };

            reader.readAsDataURL(
                file
            );
        };

    input.click();
}

/* =====================================================
   HOME
===================================================== */

function showHome() {

    currentPage =
        "home";

    render(`
        <header class="topbar">
            <div>
                <h1>VedChat</h1>
                <small>
                    Private real-time messaging
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="showProfile()"
            >
                👤
            </button>
        </header>

        <main>

            <div class="welcome-card">

                ${avatarHTML(
                    myAvatar,
                    myName,
                    64
                )}

                <div>
                    <h2>
                        Hi, ${escapeHTML(
                            myName
                        )} 👋
                    </h2>

                    <div class="online">
                        ● ${
                            connectionState ===
                            "connected"
                                ? "Online"
                                : "Connecting..."
                        }
                    </div>
                </div>

            </div>

            <div class="code-card">

                <small>
                    Your connection code
                </small>

                <strong>
                    ${escapeHTML(myCode || "Creating...")}
                </strong>

                <button
                    class="secondary-btn"
                    onclick="copyCode()"
                >
                    📋 Copy
                </button>

            </div>

            <div class="grid-buttons">

                <button
                    onclick="showChats()"
                >
                    💬
                    <span>Chats</span>
                </button>

                <button
                    onclick="showFriends()"
                >
                    🧑‍🤝‍🧑
                    <span>Friends</span>
                </button>

                <button
                    onclick="showGroups()"
                >
                    👥
                    <span>Groups</span>
                </button>

                <button
                    onclick="showConnect()"
                >
                    🔗
                    <span>Connect</span>
                </button>

            </div>

            <button
                class="primary-btn"
                onclick="showCallHistory()"
            >
                📞 Call History
            </button>

        </main>

        ${bottomNav("home")}
    `);
}

/* =====================================================
   COPY CODE
===================================================== */

function copyCode() {

    if (!myCode) return;

    navigator.clipboard
        ?.writeText(myCode)
        .then(() =>
            alert("Code copied!")
        )
        .catch(() =>
            alert(
                "Your code is: " +
                myCode
            )
        );
}

/* =====================================================
   CONNECTION
===================================================== */

function showConnect() {

    currentPage =
        "connect";

    render(`
        <header class="topbar">
            <div>
                <h1>Connect</h1>
                <small>Add a friend</small>
            </div>
        </header>

        <main>

            <div class="card">

                <h2>🔢 Connection Code</h2>

                <p>
                    Enter someone's 10-character
                    VedChat code.
                </p>

                <input
                    id="friendCode"
                    maxlength="10"
                    placeholder="XXXXXXXXXX"
                    autocomplete="off"
                    style="text-transform:uppercase"
                >

                <button
                    class="primary-btn"
                    onclick="lookupFriend()"
                >
                    🔍 Find User
                </button>

            </div>

            <div class="card">

                <h2>📷 Scan QR</h2>

                <button
                    class="secondary-btn"
                    onclick="startQRScanner()"
                >
                    📷 Scan QR Code
                </button>

                <div id="scanner"></div>

            </div>

            <div class="card">

                <h2>🔳 Your QR Code</h2>

                <div
                    id="myQR"
                    class="qr-box"
                ></div>

            </div>

        </main>

        ${bottomNav("home")}
    `);

    generateMyQR();
}

function lookupFriend() {

    const input =
        document.getElementById(
            "friendCode"
        );

    if (!input) return;

    const code =
        input.value
            .trim()
            .toUpperCase();

    if (code.length !== 10) {

        alert(
            "The code must be exactly 10 characters."
        );

        return;
    }

    send({
        type: "lookup-user",
        code
    });
}

function showFoundUser(
    user,
    online
) {

    const app =
        document.getElementById(
            "app"
        );

    if (!app) return;

    const card =
        document.createElement(
            "div"
        );

    card.className =
        "card found-user";

    card.innerHTML = `
        ${avatarHTML(
            user.avatar,
            user.name,
            70
        )}

        <div class="found-info">
            <h2>
                ${escapeHTML(
                    user.name
                )}
            </h2>

            <p>
                ${online
                    ? "🟢 Online"
                    : "⚪ Offline"}
            </p>

            <small>
                ${escapeHTML(
                    user.code
                )}
            </small>
        </div>

        <button
            class="primary-btn"
            onclick="addFriend('${escapeHTML(
                user.code
            )}')"
        >
            🧑‍🤝‍🧑 Add Friend
        </button>
    `;

    app
        .querySelector("main")
        .appendChild(card);
}

function addFriend(code) {

    send({
        type: "add-friend",
        code
    });
}

/* =====================================================
   QR
===================================================== */

function generateMyQR() {

    const box =
        document.getElementById(
            "myQR"
        );

    if (!box || !myCode) return;

    box.innerHTML = "";

    if (
        typeof QRCode !==
        "undefined"
    ) {

        new QRCode(
            box,
            {
                text: myCode,
                width: 220,
                height: 220
            }
        );

    } else {

        box.innerHTML = `
            <strong>
                ${escapeHTML(myCode)}
            </strong>
        `;
    }
}

async function startQRScanner() {

    const scanner =
        document.getElementById(
            "scanner"
        );

    if (!scanner) return;

    if (
        !("BarcodeDetector" in window)
    ) {

        scanner.innerHTML = `
            <div class="warning">
                Your browser does not support
                built-in QR scanning.
                Please enter the 10-character
                code manually.
            </div>
        `;

        return;
    }

    try {

        const stream =
            await navigator
                .mediaDevices
                .getUserMedia({
                    video: {
                        facingMode:
                            "environment"
                    }
                });

        const video =
            document.createElement(
                "video"
            );

        video.autoplay = true;
        video.playsInline = true;
        video.srcObject = stream;

        scanner.innerHTML = "";
        scanner.appendChild(video);

        const detector =
            new BarcodeDetector({
                formats: ["qr_code"]
            });

        const scan =
            async () => {

                if (
                    video.readyState <
                    2
                ) {
                    requestAnimationFrame(
                        scan
                    );
                    return;
                }

                try {

                    const codes =
                        await detector
                            .detect(video);

                    if (
                        codes.length
                    ) {

                        const value =
                            codes[0].rawValue
                                .trim()
                                .toUpperCase();

                        stream
                            .getTracks()
                            .forEach(
                                track =>
                                    track.stop()
                            );

                        if (
                            value.length ===
                            10
                        ) {

                            document
                                .getElementById(
                                    "friendCode"
                                )
                                .value =
                                value;

                            lookupFriend();

                        } else {

                            alert(
                                "That QR code does not contain a VedChat code."
                            );
                        }

                        return;
                    }

                } catch {}

                requestAnimationFrame(
                    scan
                );
            };

        scan();

    } catch (error) {

        console.error(error);

        scanner.innerHTML = `
            <div class="warning">
                Camera permission was denied
                or the camera could not be opened.
            </div>
        `;
    }
}

/* =====================================================
   FRIENDS
===================================================== */

function getFriends() {

    if (
        connectionState !==
        "connected"
    ) {
        return;
    }

    send({
        type: "get-friends"
    });
}

function showFriends() {

    currentPage =
        "friends";

    render(`
        <header class="topbar">
            <div>
                <h1>Friends</h1>
                <small>
                    ${friends.length} friend(s)
                </small>
            </div>
        </header>

        <main>

            <button
                class="primary-btn"
                onclick="showConnect()"
            >
                ➕ Add Friend
            </button>

            <div id="friendsList"></div>

        </main>

        ${bottomNav("friends")}
    `);

    const list =
        document.getElementById(
            "friendsList"
        );

    if (!friends.length) {

        list.innerHTML = `
            <div class="empty">
                <div class="empty-icon">🧑‍🤝‍🧑</div>
                <h3>No friends yet</h3>
                <p>
                    Add someone using their
                    10-character code.
                </p>
            </div>
        `;

        return;
    }

    friends.forEach(
        friend => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "friend-item";

            item.innerHTML = `
                ${avatarHTML(
                    friend.avatar,
                    friend.name
                )}

                <div class="friend-info">

                    <strong>
                        ${escapeHTML(
                            friend.name
                        )}
                    </strong>

                    <small>
                        ${
                            friend.online
                                ? "🟢 Online"
                                : "⚪ Offline"
                        }
                    </small>

                </div>

                <button
                    class="small-action"
                    onclick="openPrivateChat(
                        '${escapeHTML(
                            friend.code
                        )}'
                    )"
                >
                    💬
                </button>

                <button
                    class="small-action"
                    onclick="startPrivateCall(
                        '${escapeHTML(
                            friend.code
                        )}'
                    )"
                >
                    📞
                </button>
            `;

            list.appendChild(item);
        }
    );
}

/* =====================================================
   PRIVATE CHAT
===================================================== */

function getPrivateMessages(code) {

    if (!privateMessages[code]) {
        privateMessages[code] = [];
    }

    return privateMessages[code];
}

function receivePrivateMessage(
    message
) {

    const other =
        message.from === myCode
            ? message.to
            : message.from;

    if (!other) return;

    const messages =
        getPrivateMessages(other);

    messages.push(message);

    saveLocal();

    if (
        currentPage ===
            "private-chat" &&
        currentFriend === other
    ) {
        displayPrivateMessages();
    }
}

function openPrivateChat(code) {

    currentFriend =
        code;

    currentPage =
        "private-chat";

    const friend =
        friends.find(
            item =>
                item.code === code
        );

    render(`
        <header class="chat-header">

            <button
                class="back-btn"
                onclick="showFriends()"
            >
                ←
            </button>

            ${
                avatarHTML(
                    friend?.avatar || "",
                    friend?.name || "User",
                    44
                )
            }

            <div>
                <strong>
                    ${escapeHTML(
                        friend?.name ||
                        "User"
                    )}
                </strong>

                <small>
                    ${
                        friend?.online
                            ? "🟢 Online"
                            : "Offline"
                    }
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="startPrivateCall(
                    '${escapeHTML(code)}'
                )"
            >
                📞
            </button>

        </header>

        <main class="chat-page">

            <div
                id="privateMessageArea"
                class="message-area"
            ></div>

            <div class="composer">

                <input
                    id="privateMessageInput"
                    placeholder="Message..."
                >

                <button
                    onclick="sendPrivateMessage()"
                >
                    ➤
                </button>

            </div>

        </main>
    `);

    const input =
        document.getElementById(
            "privateMessageInput"
        );

    input?.addEventListener(
        "keydown",
        event => {

            if (
                event.key ===
                "Enter"
            ) {
                sendPrivateMessage();
            }
        }
    );

    displayPrivateMessages();
}

function sendPrivateMessage() {

    const input =
        document.getElementById(
            "privateMessageInput"
        );

    if (!input) return;

    const text =
        input.value.trim();

    if (!text) return;

    send({
        type: "private-chat",
        to: currentFriend,
        text
    });

    input.value = "";
}

function displayPrivateMessages() {

    const area =
        document.getElementById(
            "privateMessageArea"
        );

    if (!area) return;

    const messages =
        getPrivateMessages(
            currentFriend
        );

    area.innerHTML = "";

    messages.forEach(
        message => {

            const mine =
                message.from ===
                myCode;

            const bubble =
                document.createElement(
                    "div"
                );

            bubble.className =
                mine
                    ? "message mine"
                    : "message";

            bubble.innerHTML = `
                <strong>
                    ${escapeHTML(
                        message.sender ||
                        ""
                    )}
                </strong>

                <div>
                    ${escapeHTML(
                        message.text
                    )}
                </div>

                <span class="message-time">
                    ${formatTime(
                        message.time
                    )}
                </span>
            `;

            area.appendChild(
                bubble
            );
        }
    );

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   CHATS
===================================================== */

function showChats() {

    currentPage =
        "chats";

    render(`
        <header class="topbar">
            <div>
                <h1>Chats</h1>
                <small>
                    Your conversations
                </small>
            </div>
        </header>

        <main>

            <button
                class="primary-btn"
                onclick="showFriends()"
            >
                🧑‍🤝‍🧑 Start a Chat
            </button>

            <div class="section-title">
                Recent Chats
            </div>

            <div id="recentChats"></div>

        </main>

        ${bottomNav("chats")}
    `);

    const list =
        document.getElementById(
            "recentChats"
        );

    const codes =
        Object.keys(
            privateMessages
        );

    if (!codes.length) {

        list.innerHTML = `
            <div class="empty">
                💬
                <h3>No chats yet</h3>
                <p>
                    Add a friend to start chatting.
                </p>
            </div>
        `;

        return;
    }

    codes.forEach(code => {

        const friend =
            friends.find(
                item =>
                    item.code === code
            );

        const messages =
            privateMessages[code] || [];

        const last =
            messages[
                messages.length - 1
            ];

        if (!last) return;

        const item =
            document.createElement(
                "div"
            );

        item.className =
            "friend-item";

        item.onclick =
            () => openPrivateChat(code);

        item.innerHTML = `
            ${avatarHTML(
                friend?.avatar || "",
                friend?.name || last.sender
            )}

            <div class="friend-info">

                <strong>
                    ${escapeHTML(
                        friend?.name ||
                        last.sender ||
                        "User"
                    )}
                </strong>

                <small>
                    ${escapeHTML(
                        last.text
                    )}
                </small>

            </div>

            <small>
                ${formatTime(
                    last.time
                )}
            </small>
        `;

        list.appendChild(item);
    });
}

/* =====================================================
   GROUPS
===================================================== */

function getGroups() {

    if (
        connectionState !==
        "connected"
    ) return;

    send({
        type: "get-groups"
    });
}

function showGroups() {

    currentPage =
        "groups";

    render(`
        <header class="topbar">
            <div>
                <h1>Groups</h1>
                <small>
                    Group conversations
                </small>
            </div>
        </header>

        <main>

            <button
                class="primary-btn"
                onclick="createGroup()"
            >
                ➕ Create Group
            </button>

            <div id="groupList"></div>

        </main>

        ${bottomNav("groups")}
    `);

    const list =
        document.getElementById(
            "groupList"
        );

    if (!groups.length) {

        list.innerHTML = `
            <div class="empty">
                👥
                <h3>No groups yet</h3>
                <p>
                    Create your first group.
                </p>
            </div>
        `;

        return;
    }

    groups.forEach(group => {

        const item =
            document.createElement(
                "div"
            );

        item.className =
            "group-item";

        item.onclick =
            () =>
                openGroupChat(
                    group.id
                );

        item.innerHTML = `
            <div class="group-icon">
                👥
            </div>

            <div class="friend-info">

                <strong>
                    ${escapeHTML(
                        group.name
                    )}
                </strong>

                <small>
                    ${group.members.length}
                    members
                </small>

            </div>

            <span>›</span>
        `;

        list.appendChild(item);
    });
}

function createGroup() {

    const name =
        prompt(
            "Enter group name:"
        );

    if (
        !name ||
        !name.trim()
    ) {
        return;
    }

    send({
        type: "create-group",
        name: name.trim()
    });
}

function openGroupChat(groupId) {

    const group =
        groups.find(
            item =>
                item.id === groupId
        );

    if (!group) return;

    currentGroup =
        groupId;

    currentPage =
        "group-chat";

    render(`
        <header class="chat-header">

            <button
                class="back-btn"
                onclick="showGroups()"
            >
                ←
            </button>

            <div class="group-icon small">
                👥
            </div>

            <div>
                <strong>
                    ${escapeHTML(
                        group.name
                    )}
                </strong>

                <small>
                    ${group.members.length}
                    members
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="startGroupCall(
                    '${escapeHTML(groupId)}'
                )"
            >
                📞
            </button>

        </header>

        <main class="chat-page">

            <div
                id="groupMessageArea"
                class="message-area"
            ></div>

            <div class="composer">

                <input
                    id="groupMessageInput"
                    placeholder="Message group..."
                >

                <button
                    onclick="sendGroupMessage()"
                >
                    ➤
                </button>

            </div>

        </main>
    `);

    const input =
        document.getElementById(
            "groupMessageInput"
        );

    input?.addEventListener(
        "keydown",
        event => {

            if (
                event.key === "Enter"
            ) {
                sendGroupMessage();
            }
        }
    );

    displayGroupMessages();
}

function sendGroupMessage() {

    const input =
        document.getElementById(
            "groupMessageInput"
        );

    if (!input) return;

    const text =
        input.value.trim();

    if (!text) return;

    send({
        type: "group-chat",
        groupId: currentGroup,
        text
    });

    input.value = "";
}

function receiveGroupMessage(
    message
) {

    if (
        !groupMessages[
            message.groupId
        ]
    ) {
        groupMessages[
            message.groupId
        ] = [];
    }

    groupMessages[
        message.groupId
    ].push(message);

    saveLocal();

    if (
        currentPage ===
            "group-chat" &&
        currentGroup ===
            message.groupId
    ) {
        displayGroupMessages();
    }
}

function displayGroupMessages() {

    const area =
        document.getElementById(
            "groupMessageArea"
        );

    if (!area) return;

    const messages =
        groupMessages[
            currentGroup
        ] || [];

    area.innerHTML = "";

    messages.forEach(
        message => {

            const bubble =
                document.createElement(
                    "div"
                );

            bubble.className =
                message.from === myCode
                    ? "message mine"
                    : "message";

            bubble.innerHTML = `
                <strong>
                    ${escapeHTML(
                        message.sender
                    )}
                </strong>

                <div>
                    ${escapeHTML(
                        message.text
                    )}
                </div>

                <span class="message-time">
                    ${formatTime(
                        message.time
                    )}
                </span>
            `;

            area.appendChild(
                bubble
            );
        }
    );

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   CALLING
===================================================== */

async function getMicrophone() {

    if (!navigator.mediaDevices) {

        throw new Error(
            "Media devices unavailable"
        );
    }

    return navigator.mediaDevices
        .getUserMedia({
            audio: true,
            video: false
        });
}

function rtcConfig() {

    return {
        iceServers: [
            {
                urls:
                    "stun:stun.l.google.com:19302"
            },
            {
                urls:
                    "stun:stun1.l.google.com:19302"
            }
        ]
    };
}

function createPeer(
    peerId,
    target,
    groupId = null
) {

    const pc =
        new RTCPeerConnection(
            rtcConfig()
        );

    peerConnections[
        peerId
    ] = pc;

    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                track => {

                    pc.addTrack(
                        track,
                        localStream
                    );
                }
            );
    }

    pc.onicecandidate =
        event => {

            if (
                event.candidate
            ) {

                send({
                    type:
                        "ice-candidate",
                    to:
                        groupId
                            ? undefined
                            : target,
                    groupId,
                    target,
                    candidate:
                        event.candidate
                });
            }
        };

    pc.ontrack =
        event => {

            let audio =
                document.getElementById(
                    "audio-" +
                    peerId
                );

            if (!audio) {

                audio =
                    document.createElement(
                        "audio"
                    );

                audio.id =
                    "audio-" +
                    peerId;

                audio.autoplay =
                    true;

                document.body.appendChild(
                    audio
                );
            }

            audio.srcObject =
                event.streams[0];
        };

    return pc;
}

async function startPrivateCall(
    code
) {

    try {

        localStream =
            await getMicrophone();

        const callId =
            Date.now().toString();

        const pc =
            createPeer(
                code,
                code
            );

        await showCallUI(
            "Calling..."
        );

        const offer =
            await pc.createOffer();

        await pc.setLocalDescription(
            offer
        );

        send({
            type: "call-offer",
            to: code,
            callId,
            offer
        });

        callHistory.unshift({
            type: "outgoing",
            name:
                friends.find(
                    f =>
                        f.code === code
                )?.name ||
                "User",
            code,
            time:
                new Date().toISOString(),
            status: "Outgoing"
        });

        saveLocal();

    } catch (error) {

        console.error(error);

        alert(
            "Could not start the call. Make sure microphone permission is allowed."
        );

        cleanupCall();
    }
}

async function receiveIncomingCall(
    message
) {

    if (incomingCall) {

        return;
    }

    incomingCall =
        message;

    showIncomingCall();
}

function showIncomingCall() {

    if (!incomingCall) return;

    const caller =
        incomingCall.sender ||
        "User";

    render(`
        <div class="incoming-call">

            <div class="incoming-icon">
                📞
            </div>

            <h1>
                Incoming Call
            </h1>

            <h2>
                ${escapeHTML(
                    caller
                )}
            </h2>

            <p>
                is calling you...
            </p>

            <button
                class="primary-btn"
                onclick="answerIncomingCall()"
            >
                📞 Answer
            </button>

            <button
                class="danger-btn"
                onclick="declineIncomingCall()"
            >
                ❌ Decline
            </button>

        </div>
    `);
}

async function answerIncomingCall() {

    if (!incomingCall) return;

    try {

        localStream =
            await getMicrophone();

        const peerId =
            incomingCall.from;

        const pc =
            createPeer(
                peerId,
                peerId,
                incomingCall.groupId
            );

        await pc.setRemoteDescription(
            new RTCSessionDescription(
                incomingCall.offer
            )
        );

        const answer =
            await pc.createAnswer();

        await pc.setLocalDescription(
            answer
        );

        send({
            type:
                "call-answer",
            to:
                incomingCall.from,
            target:
                incomingCall.from,
            groupId:
                incomingCall.groupId,
            callId:
                incomingCall.callId,
            answer
        });

        await showCallUI(
            "Connected"
        );

        incomingCall =
            null;

    } catch (error) {

        console.error(error);

        alert(
            "Could not answer the call."
        );

        cleanupCall();
    }
}

function declineIncomingCall() {

    if (!incomingCall) return;

    send({
        type: "call-decline",
        to:
            incomingCall.from,
        groupId:
            incomingCall.groupId,
        callId:
            incomingCall.callId
    });

    incomingCall =
        null;

    showHome();
}

async function handleCallAnswer(
    message
) {

    const pc =
        peerConnections[
            message.from
        ];

    if (!pc) return;

    try {

        await pc.setRemoteDescription(
            new RTCSessionDescription(
                message.answer
            )
        );

        showCallUI(
            "Connected"
        );

    } catch (error) {

        console.error(error);
    }
}

async function handleIceCandidate(
    message
) {

    const pc =
        peerConnections[
            message.from
        ];

    if (!pc) return;

    try {

        await pc.addIceCandidate(
            message.candidate
        );

    } catch (error) {

        console.error(
            "ICE error:",
            error
        );
    }
}

async function startGroupCall(
    groupId
) {

    try {

        localStream =
            await getMicrophone();

        const group =
            groups.find(
                g =>
                    g.id === groupId
            );

        if (!group) return;

        await showCallUI(
            "Starting group call..."
        );

        /*
         * Tell all group members
         * that a call is starting.
         */

        send({
            type: "call",
            action: "offer",
            groupId,
            callId:
                Date.now().toString()
        });

        /*
         * Create offers for currently
         * online group members.
         */

        for (
            const member of
                group.members
        ) {

            if (
                member === myCode
            ) continue;

            const friendOnline =
                friends.some(
                    f =>
                        f.code ===
                            member &&
                        f.online
                );

            if (!friendOnline) {
                continue;
            }

            const pc =
                createPeer(
                    member,
                    member,
                    groupId
                );

            const offer =
                await pc.createOffer();

            await pc.setLocalDescription(
                offer
            );

            send({
                type:
                    "call-offer",
                to:
                    member,
                target:
                    member,
                groupId,
                callId:
                    Date.now().toString(),
                offer
            });
        }

    } catch (error) {

        console.error(error);

        alert(
            "Could not start group call."
        );

        cleanupCall();
    }
}

async function showCallUI(
    status
) {

    currentPage =
        "call";

    render(`
        <div class="call-screen">

            <div class="call-logo">
                📞
            </div>

            <h1>
                VedChat Call
            </h1>

            <p id="callStatus">
                ${escapeHTML(status)}
            </p>

            <div
                class="call-members"
                id="callMembers"
            >
                🎙️
            </div>

            <button
                class="danger-btn"
                onclick="endCall()"
            >
                📵 End Call
            </button>

        </div>
    `);
}

function endCall() {

    send({
        type: "call-end",
        to:
            currentFriend
    });

    endAllCallConnections();

    callHistory.unshift({
        type: "call",
        name:
            currentFriend || "Group",
        time:
            new Date().toISOString(),
        status: "Ended"
    });

    saveLocal();

    showHome();
}

function endAllCallConnections() {

    Object.values(
        peerConnections
    ).forEach(
        pc => {

            try {
                pc.close();
            } catch {}
        }
    );

    peerConnections = {};

    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );
    }

    localStream = null;
}

/* =====================================================
   CALL HISTORY
===================================================== */

function finishCallHistory(
    status
) {

    callHistory.unshift({
        type: "call",
        time:
            new Date().toISOString(),
        status
    });

    saveLocal();
}

function showCallHistory() {

    currentPage =
        "history";

    render(`
        <header class="topbar">
            <div>
                <h1>Call History</h1>
                <small>
                    Recent calls
                </small>
            </div>
        </header>

        <main>

            <div id="callHistoryList"></div>

        </main>

        ${bottomNav("home")}
    `);

    const list =
        document.getElementById(
            "callHistoryList"
        );

    if (!callHistory.length) {

        list.innerHTML = `
            <div class="empty">
                📞
                <h3>No calls yet</h3>
            </div>
        `;

        return;
    }

    callHistory
        .slice(0, 50)
        .forEach(call => {

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "friend-item";

            item.innerHTML = `
                <div class="call-history-icon">
                    📞
                </div>

                <div class="friend-info">

                    <strong>
                        ${escapeHTML(
                            call.name ||
                            "VedChat Call"
                        )}
                    </strong>

                    <small>
                        ${escapeHTML(
                            call.status ||
                            ""
                        )}
                    </small>

                </div>

                <small>
                    ${formatTime(
                        call.time
                    )}
                </small>
            `;

            list.appendChild(
                item
            );
        });
}

/* =====================================================
   PROFILE
===================================================== */

function showProfile() {

    currentPage =
        "profile";

    render(`
        <header class="topbar">
            <div>
                <h1>Profile</h1>
                <small>
                    Your VedChat account
                </small>
            </div>
        </header>

        <main>

            <div class="profile-card">

                <div
                    class="profile-avatar"
                    onclick="chooseAvatar()"
                >
                    ${avatarHTML(
                        myAvatar,
                        myName,
                        110
                    )}

                    <div class="camera">
                        📷
                    </div>
                </div>

                <h2>
                    ${escapeHTML(
                        myName
                    )}
                </h2>

                <div class="profile-code">
                    ${escapeHTML(
                        myCode
                    )}
                </div>

                <button
                    class="primary-btn"
                    onclick="chooseAvatar()"
                >
                    📷 Change Profile Picture
                </button>

                <button
                    class="secondary-btn"
                    onclick="editProfile()"
                >
                    ✏️ Edit Name
                </button>

            </div>

            <div class="stat-row">

                <div class="stat">
                    <strong>
                        ${friends.length}
                    </strong>
                    <span>Friends</span>
                </div>

                <div class="stat">
                    <strong>
                        ${groups.length}
                    </strong>
                    <span>Groups</span>
                </div>

                <div class="stat">
                    <strong>
                        ${callHistory.length}
                    </strong>
                    <span>Calls</span>
                </div>

            </div>

        </main>

        ${bottomNav("profile")}
    `);
}

/* =====================================================
   NAVIGATION
===================================================== */

function bottomNav(active) {

    return `
        <nav class="bottom-nav">

            <button
                class="${
                    active === "home"
                        ? "active"
                        : ""
                }"
                onclick="showHome()"
            >
                🏠
                <span>Home</span>
            </button>

            <button
                class="${
                    active === "chats"
                        ? "active"
                        : ""
                }"
                onclick="showChats()"
            >
                💬
                <span>Chats</span>
            </button>

            <button
                class="${
                    active === "friends"
                        ? "active"
                        : ""
                }"
                onclick="showFriends()"
            >
                🧑‍🤝‍🧑
                <span>Friends</span>
            </button>

            <button
                class="${
                    active === "groups"
                        ? "active"
                        : ""
                }"
                onclick="showGroups()"
            >
                👥
                <span>Groups</span>
            </button>

            <button
                class="${
                    active === "profile"
                        ? "active"
                        : ""
                }"
                onclick="showProfile()"
            >
                👤
                <span>Me</span>
            </button>

        </nav>
    `;
}

/* =====================================================
   STATUS
===================================================== */

function updateStatus() {

    const indicator =
        document.getElementById(
            "connectionIndicator"
        );

    if (indicator) {

        indicator.textContent =
            connectionState;
    }

    /*
     * Don't rerender chat screens
     * just because WebSocket status changes.
     */

    if (
        currentPage ===
            "home" &&
        document.getElementById(
            "app"
        )
    ) {
        showHome();
    }
}

/* =====================================================
   RENDER
===================================================== */

function render(content) {

    const app =
        document.getElementById(
            "app"
        );

    if (!app) return;

    app.innerHTML = `
        <div class="app">
            ${content}
        </div>
    `;
}

/* =====================================================
   TIME
===================================================== */

function formatTime(time) {

    if (!time) return "";

    const date =
        new Date(time);

    if (Number.isNaN(
        date.getTime()
    )) {
        return "";
    }

    return date.toLocaleTimeString(
        [],
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );
}

/* =====================================================
   STARTUP
===================================================== */

createAccountIfNeeded();

connectServer();

showHome();