/* =========================================================
   VEDCHAT
   Server + 10-character codes + chat + profile + WebRTC calls
   ========================================================= */

"use strict";

/* =========================================================
   APP STATE
   ========================================================= */

let currentPage = "home";
let currentChat = null;

let socket = null;
let serverConnected = false;

let connectionCode = "";
let connectionState = "disconnected";
let myPeerId = "";

let peerConnection = null;
let remotePeerId = null;

let localStream = null;
let remoteStream = null;

let callState = "idle";
let currentCallId = null;
let incomingCaller = "";
let callTimer = null;
let callSeconds = 0;
let callMuted = false;

let ringtoneContext = null;
let ringtoneOscillator = null;
let ringtoneGain = null;
let ringtoneInterval = null;

/* =========================================================
   SERVER URL
   ========================================================= */

/*
   If server.js is running on the SAME device:
       ws://localhost:3000

   If server.js is running on another device on Wi-Fi:
       ws://192.168.1.25:3000

   If your public server uses HTTPS:
       wss://your-server-address
*/

function getServerURL() {
    const saved = localStorage.getItem("vedchat_server");

    if (saved) {
        return saved;
    }

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return protocol + "//" + location.host;
}

/* =========================================================
   STORAGE
   ========================================================= */

function getChats() {
    try {
        return JSON.parse(
            localStorage.getItem("vedchat_chats") || "[]"
        );
    } catch (error) {
        return [];
    }
}

function saveChats(chats) {
    localStorage.setItem(
        "vedchat_chats",
        JSON.stringify(chats)
    );
}

function getUsername() {
    return (
        localStorage.getItem("username") ||
        ""
    );
}

function getDisplayName() {
    return (
        localStorage.getItem("displayName") ||
        "Guest"
    );
}

function getStatus() {
    return (
        localStorage.getItem("status") ||
        "Available"
    );
}

/* =========================================================
   HELPERS
   ========================================================= */

function escapeHTML(text) {
    const div = document.createElement("div");
    div.textContent = String(text ?? "");
    return div.innerHTML;
}

function randomId() {
    return (
        Date.now().toString(36) +
        Math.random()
            .toString(36)
            .substring(2, 8)
    );
}

function formatTime(value) {
    try {
        return new Date(value).toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );
    } catch (error) {
        return "";
    }
}

function connectionBadge() {
    if (connectionState === "connected") {
        return `
            <span class="offline">
                🟢 CONNECTED
            </span>
        `;
    }

    if (serverConnected) {
        return `
            <span class="offline">
                🟡 SERVER ONLINE
            </span>
        `;
    }

    return `
        <span class="offline">
            🔴 OFFLINE
        </span>
    `;
}

/* =========================================================
   START
   ========================================================= */

function startApp() {
    applyTheme();

    /*
       Do NOT ask for display name every time.

       Only ask once if the user has never created
       a profile.
    */

    if (!localStorage.getItem("displayName")) {
        showFirstProfileSetup();
    } else {
        showHome();
    }

    connectToServer();
}

/* =========================================================
   FIRST PROFILE SETUP
   ========================================================= */

function showFirstProfileSetup() {
    render(`
        <header>
            <div>
                <h1>VedChat</h1>
                <small>Welcome</small>
            </div>
        </header>

        <main>

            <h2>👋 Welcome to VedChat</h2>

            <p>
                Create your profile to get started.
            </p>

            <input
                class="search"
                id="firstDisplayName"
                placeholder="Display name"
                autocomplete="off"
            >

            <input
                class="search"
                id="firstUsername"
                placeholder="Username (optional)"
                autocomplete="off"
            >

            <button
                class="primary-btn"
                onclick="saveFirstProfile()"
            >
                Continue
            </button>

        </main>
    `);
}

function saveFirstProfile() {
    const nameInput =
        document.getElementById("firstDisplayName");

    const usernameInput =
        document.getElementById("firstUsername");

    if (!nameInput) {
        return;
    }

    const name =
        nameInput.value.trim();

    const username =
        usernameInput
            ? usernameInput.value.trim()
            : "";

    if (!name) {
        alert("Please enter a display name.");
        return;
    }

    localStorage.setItem(
        "displayName",
        name
    );

    localStorage.setItem(
        "username",
        username
    );

    localStorage.setItem(
        "status",
        "Available"
    );

    showHome();
}

/* =========================================================
   THEME
   ========================================================= */

function applyTheme() {
    const dark =
        localStorage.getItem("darkMode") === "true";

    document.body.classList.toggle(
        "dark",
        dark
    );
}

function toggleDarkMode() {
    const current =
        localStorage.getItem("darkMode") === "true";

    localStorage.setItem(
        "darkMode",
        String(!current)
    );

    applyTheme();

    showSettings();
}

/* =========================================================
   SERVER CONNECTION
   ========================================================= */

function connectToServer() {
    if (socket) {
        try {
            socket.close();
        } catch (error) {}
    }

    const url = getServerURL();

    try {
        socket = new WebSocket(url);
    } catch (error) {
        serverConnected = false;
        return;
    }

    socket.onopen = function() {
        serverConnected = true;

        sendServerMessage({
            type: "hello",
            name: getDisplayName(),
            username: getUsername(),
            status: getStatus(),
            peerId: myPeerId
        });

        if (currentPage === "home") {
            showHome();
        }
    };

    socket.onclose = function() {
        serverConnected = false;

        if (connectionState !== "connected") {
            connectionState =
                "disconnected";
        }

        if (currentPage === "home") {
            showHome();
        }
    };

    socket.onerror = function(error) {
        console.error(
            "VedChat server error:",
            error
        );

        serverConnected = false;
    };

    socket.onmessage = function(event) {
        handleServerMessage(event.data);
    };
}

/* =========================================================
   SERVER SEND
   ========================================================= */

function sendServerMessage(data) {
    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        return false;
    }

    try {
        socket.send(
            JSON.stringify(data)
        );

        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

/* =========================================================
   SERVER RECEIVE
   ========================================================= */

function handleServerMessage(raw) {
    let message;

    try {
        message =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;
    } catch (error) {
        console.error(
            "Invalid server message:",
            error
        );
        return;
    }

    if (!message) {
        return;
    }

    console.log(
        "SERVER:",
        message
    );

    /*
       Server identity
    */

    if (
        message.type === "hello" ||
        message.type === "welcome"
    ) {
        if (message.peerId) {
            myPeerId =
                message.peerId;
        }

        return;
    }

    /*
       Room created
    */

    if (
        message.type === "created" ||
        message.type === "room-created" ||
        message.type === "connection-created"
    ) {
        connectionCode =
            message.code ||
            message.connectionCode ||
            "";

        if (connectionCode) {
            showCreatedConnection(
                connectionCode
            );
        }

        return;
    }

    /*
       Successfully joined
    */

    if (
        message.type === "joined" ||
        message.type === "room-joined" ||
        message.type === "connection-joined"
    ) {
        connectionCode =
            message.code ||
            connectionCode;

        connectionState =
            "connected";

        remotePeerId =
            message.peerId ||
            message.remotePeerId ||
            null;

        alert(
            "🟢 Connected to VedChat user!"
        );

        showHome();

        return;
    }

    /*
       Other person joined our room
    */

    if (
        message.type === "peer-joined" ||
        message.type === "user-joined"
    ) {
        connectionState =
            "connected";

        remotePeerId =
            message.peerId ||
            message.remotePeerId ||
            null;

        showHome();

        return;
    }

    /*
       Other person left
    */

    if (
        message.type === "peer-left" ||
        message.type === "user-left" ||
        message.type === "disconnected"
    ) {
        connectionState =
            "disconnected";

        remotePeerId = null;

        if (callState !== "idle") {
            endCall(false);
        }

        if (currentPage === "home") {
            showHome();
        }

        return;
    }

    /*
       WebRTC signaling
    */

    if (
        message.type === "signal" ||
        message.type === "webrtc" ||
        message.type === "offer" ||
        message.type === "answer" ||
        message.type === "ice"
    ) {
        handleWebRTCSignal(message);
        return;
    }

    /*
       Some servers wrap signaling data.
    */

    if (
        message.signal
    ) {
        handleWebRTCSignal(
            message.signal
        );

        return;
    }

    /*
       Chat
    */

    if (
        message.type === "message" ||
        message.type === "chat"
    ) {
        receiveMessage({
            sender:
                message.sender ||
                message.name ||
                "User",

            text:
                message.text ||
                message.message ||
                "",

            time:
                message.time ||
                new Date().toISOString()
        });

        return;
    }

    /*
       Call signaling through server.
    */

    if (
        message.type === "call"
    ) {
        handleCallSignal(
            message
        );
    }
}

/* =========================================================
   HOME
   ========================================================= */

function showHome() {
    currentPage = "home";

    render(`
        <header>
            <div>
                <h1>VedChat</h1>
                <small>Private real-time chat</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <h2>
                Welcome 👋
            </h2>

            <p>
                Hello,
                ${escapeHTML(getDisplayName())}!
            </p>

            <button
                class="primary-btn"
                onclick="showChats()"
            >
                💬 Chats
            </button>

            <button
                class="primary-btn"
                onclick="showConnection()"
            >
                🔗 Connect
            </button>

            <button
                class="secondary-btn"
                onclick="showCalls()"
            >
                📞 Calls
            </button>

            <button
                class="secondary-btn"
                onclick="showProfile()"
            >
                👤 Profile
            </button>

            <button
                class="secondary-btn"
                onclick="showSettings()"
            >
                ⚙️ Settings
            </button>

            <div class="stat">
                <strong>
                    ${getChats().length}
                </strong>

                <br>

                <small>
                    Local Chats
                </small>
            </div>

            <div class="stat">
                <strong>
                    ${
                        connectionState === "connected"
                            ? "🟢"
                            : "🔴"
                    }
                </strong>

                <br>

                <small>
                    ${
                        connectionState === "connected"
                            ? "User Connected"
                            : "No User Connected"
                    }
                </small>
            </div>

        </main>

        ${bottomNav("home")}
    `);
}

/* =========================================================
   CHAT LIST
   ========================================================= */

function showChats() {
    currentPage = "chats";

    render(`
        <header>
            <div>
                <h1>Chats</h1>
                <small>Your conversations</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <input
                class="search"
                id="chatSearch"
                placeholder="🔍 Search chats..."
                oninput="filterChats()"
            >

            <button
                class="primary-btn"
                onclick="showNewChat()"
            >
                ＋ New Chat
            </button>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                🔗 Connect User
            </button>

            <div id="chatList"></div>

        </main>

        ${bottomNav("chats")}
    `);

    renderChatList();
}

function renderChatList(search = "") {
    const list =
        document.getElementById(
            "chatList"
        );

    if (!list) {
        return;
    }

    const chats =
        getChats();

    const filtered =
        chats.filter(function(chat) {
            return String(
                chat.name || ""
            )
                .toLowerCase()
                .includes(
                    search.toLowerCase()
                );
        });

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="empty">
                No chats found.
            </div>
        `;

        return;
    }

    list.innerHTML = "";

    filtered.forEach(function(chat) {
        const originalIndex =
            chats.indexOf(chat);

        const messages =
            Array.isArray(chat.messages)
                ? chat.messages
                : [];

        const last =
            messages.length > 0
                ? messages[
                    messages.length - 1
                ].text
                : "No messages yet";

        const item =
            document.createElement(
                "div"
            );

        item.className =
            "chat-item";

        item.innerHTML = `
            <div class="avatar">
                ${escapeHTML(
                    String(
                        chat.name || "?"
                    )
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <div
                class="chat-info"
                onclick="openChat(${originalIndex})"
            >
                <div class="chat-name">
                    ${escapeHTML(
                        chat.name ||
                        "User"
                    )}
                </div>

                <div class="last-message">
                    ${escapeHTML(last)}
                </div>
            </div>

            <div class="chat-actions">

                <button
                    class="small-btn"
                    onclick="openChat(${originalIndex})"
                >
                    Open
                </button>

                <button
                    class="small-btn"
                    onclick="deleteChat(${originalIndex})"
                >
                    🗑️
                </button>

            </div>
        `;

        list.appendChild(item);
    });
}

function filterChats() {
    const input =
        document.getElementById(
            "chatSearch"
        );

    if (!input) {
        return;
    }

    renderChatList(
        input.value
    );
}

/* =========================================================
   NEW CHAT
   ========================================================= */

function showNewChat() {
    render(`
        <header>
            <div>
                <h1>New Chat</h1>
                <small>Start a conversation</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <h2>Create a Chat</h2>

            <input
                class="search"
                id="newChatName"
                placeholder="Person's name"
            >

            <button
                class="primary-btn"
                onclick="createChat()"
            >
                Create Chat
            </button>

            <button
                class="secondary-btn"
                onclick="showChats()"
            >
                Cancel
            </button>

        </main>
    `);
}

function createChat() {
    const input =
        document.getElementById(
            "newChatName"
        );

    if (!input) {
        return;
    }

    const name =
        input.value.trim();

    if (!name) {
        alert(
            "Enter a name first."
        );
        return;
    }

    const chats =
        getChats();

    chats.push({
        name: name,
        messages: []
    });

    saveChats(chats);

    showChats();
}

/* =========================================================
   OPEN CHAT
   ========================================================= */

function openChat(index) {
    currentChat = index;

    const chats =
        getChats();

    const chat =
        chats[index];

    if (!chat) {
        showChats();
        return;
    }

    render(`
        <header>
            <div>
                <h1>
                    ${escapeHTML(
                        chat.name
                    )}
                </h1>

                <small>
                    ${
                        connectionState === "connected"
                            ? "🟢 Connected"
                            : "Local chat"
                    }
                </small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <div
                class="message-area"
                id="messageArea"
            ></div>

            <div
                class="message-input-area"
            >

                <input
                    class="message-input"
                    id="messageInput"
                    placeholder="Type a message..."
                    autocomplete="off"
                >

                <button
                    class="send-btn"
                    onclick="sendMessage()"
                >
                    Send
                </button>

            </div>

            ${
                connectionState === "connected"
                    ? `
                        <button
                            class="primary-btn"
                            onclick="startCallFromChat()"
                        >
                            📞 Voice Call
                        </button>
                    `
                    : ""
            }

            <button
                class="secondary-btn"
                onclick="showChats()"
            >
                ← Back to Chats
            </button>

        </main>
    `);

    const input =
        document.getElementById(
            "messageInput"
        );

    if (input) {
        input.addEventListener(
            "keydown",
            function(event) {
                if (
                    event.key ===
                    "Enter"
                ) {
                    sendMessage();
                }
            }
        );
    }

    displayMessages();
}

/* =========================================================
   DISPLAY MESSAGES
   ========================================================= */

function displayMessages() {
    const area =
        document.getElementById(
            "messageArea"
        );

    if (!area) {
        return;
    }

    const chats =
        getChats();

    const chat =
        chats[currentChat];

    if (!chat) {
        return;
    }

    if (!Array.isArray(chat.messages)) {
        chat.messages = [];
    }

    area.innerHTML = "";

    if (chat.messages.length === 0) {
        area.innerHTML = `
            <div class="empty">
                No messages yet.<br>
                Send the first message!
            </div>
        `;

        return;
    }

    chat.messages.forEach(
        function(message) {
            const bubble =
                document.createElement(
                    "div"
                );

            /*
               Keep sender name visible.
               Example:

               Neelesh: hi

               Vedant: hi
            */

            bubble.className =
                message.local
                    ? "message"
                    : "message";

            bubble.innerHTML = `
                <strong>
                    ${escapeHTML(
                        message.sender ||
                        "User"
                    )}
                </strong>

                <br>

                ${escapeHTML(
                    message.text
                )}

                <span
                    class="message-time"
                >
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

/* =========================================================
   SEND MESSAGE
   ========================================================= */

function sendMessage() {
    const input =
        document.getElementById(
            "messageInput"
        );

    if (!input) {
        return;
    }

    const text =
        input.value.trim();

    if (!text) {
        return;
    }

    const message = {
        type: "message",
        sender: getDisplayName(),
        username: getUsername(),
        text: text,
        time: new Date().toISOString()
    };

    /*
       Send through server.
    */

    if (
        !sendServerMessage(
            message
        )
    ) {
        alert(
            "Not connected to the VedChat server."
        );

        return;
    }

    saveLocalMessage(
        message,
        true
    );

    input.value = "";

    displayMessages();

    input.focus();
}

function saveLocalMessage(
    message,
    local
) {
    const chats =
        getChats();

    if (
        !chats[currentChat] &&
        message.sender
    ) {
        chats.push({
            name: message.sender,
            messages: []
        });

        currentChat =
            chats.length - 1;
    }

    if (!chats[currentChat]) {
        return;
    }

    if (
        !Array.isArray(
            chats[currentChat].messages
        )
    ) {
        chats[currentChat].messages = [];
    }

    chats[currentChat].messages.push({
        sender:
            message.sender ||
            "User",

        text:
            message.text ||
            "",

        time:
            message.time ||
            new Date().toISOString(),

        local:
            Boolean(local)
    });

    saveChats(chats);
}

/* =========================================================
   RECEIVE MESSAGE
   ========================================================= */

function receiveMessage(message) {
    if (!message) {
        return;
    }

    const sender =
        message.sender ||
        "User";

    const chats =
        getChats();

    let chatIndex =
        chats.findIndex(
            function(chat) {
                return (
                    chat.name ===
                    sender
                );
            }
        );

    if (chatIndex === -1) {
        chats.push({
            name: sender,
            messages: []
        });

        chatIndex =
            chats.length - 1;
    }

    if (
        !Array.isArray(
            chats[chatIndex].messages
        )
    ) {
        chats[chatIndex].messages = [];
    }

    chats[chatIndex].messages.push({
        sender: sender,
        text:
            message.text || "",
        time:
            message.time ||
            new Date().toISOString(),
        remote: true
    });

    saveChats(chats);

    playNotificationSound();

    if (
        currentChat === chatIndex
    ) {
        displayMessages();
    }
}

/* =========================================================
   DELETE MESSAGE
   ========================================================= */

function deleteMessage(index) {
    const chats =
        getChats();

    if (!chats[currentChat]) {
        return;
    }

    chats[currentChat].messages.splice(
        index,
        1
    );

    saveChats(chats);

    displayMessages();
}

/* =========================================================
   DELETE CHAT
   ========================================================= */

function deleteChat(index) {
    const chats =
        getChats();

    if (!chats[index]) {
        return;
    }

    if (
        !confirm(
            "Delete the chat with " +
            chats[index].name +
            "?"
        )
    ) {
        return;
    }

    chats.splice(
        index,
        1
    );

    saveChats(chats);

    showChats();
}

/* =========================================================
   CONNECTION SCREEN
   ========================================================= */

function showConnection() {
    render(`
        <header>
            <div>
                <h1>Connect</h1>
                <small>Connect another VedChat user</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <h2>🔗 Connect Two Users</h2>

            <p>
                Create a 10-character connection
                code on one phone and enter it
                on the other phone.
            </p>

            <div class="setting">

                <div class="setting-title">
                    ${
                        connectionState === "connected"
                            ? "🟢 Connected"
                            : "🔴 Not Connected"
                    }
                </div>

                <div class="setting-description">
                    ${
                        connectionState === "connected"
                            ? "You are connected to another user."
                            : serverConnected
                                ? "Server is ready."
                                : "Server is not connected."
                    }
                </div>

            </div>

            <button
                class="primary-btn"
                onclick="createConnection()"
            >
                🔢 Create 10-Character Code
            </button>

            <button
                class="primary-btn"
                onclick="showJoinConnection()"
            >
                🔗 Enter Connection Code
            </button>

            ${
                connectionState === "connected"
                    ? `
                        <button
                            class="danger-btn"
                            onclick="disconnectUser()"
                        >
                            Disconnect
                        </button>
                    `
                    : ""
            }

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>
    `);
}

/* =========================================================
   CREATE CONNECTION
   ========================================================= */

function createConnection() {
    if (!serverConnected) {
        alert(
            "VedChat server is not connected."
        );
        return;
    }

    sendServerMessage({
        type: "create",
        action: "create",
        name: getDisplayName(),
        username: getUsername(),
        status: getStatus()
    });

    /*
       Some simple servers may expect
       "create-room".
    */

    sendServerMessage({
        type: "create-room",
        name: getDisplayName(),
        username: getUsername()
    });
}

/* =========================================================
   SHOW CREATED CODE
   ========================================================= */

function showCreatedConnection(code) {
    connectionCode =
        String(code || "");

    render(`
        <header>
            <div>
                <h1>Your Code</h1>
                <small>Share this with the other phone</small>
            </div>
        </header>

        <main>

            <h2>🔗 Connection Code</h2>

            <p>
                Give this 10-character code
                to the other VedChat user.
            </p>

            <div
                style="
                    text-align:center;
                    font-size:30px;
                    font-weight:bold;
                    letter-spacing:5px;
                    padding:25px;
                    margin:20px 0;
                    border-radius:16px;
                    background:var(--background);
                    word-break:break-all;
                "
            >
                ${escapeHTML(code)}
            </div>

            <button
                class="primary-btn"
                onclick="copyConnectionCode()"
            >
                📋 Copy Code
            </button>

            <div class="stat">
                🟡 Waiting for another user...
            </div>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                ← Back
            </button>

        </main>
    `);
}

function copyConnectionCode() {
    if (!connectionCode) {
        return;
    }

    if (
        navigator.clipboard &&
        navigator.clipboard.writeText
    ) {
        navigator.clipboard
            .writeText(connectionCode)
            .then(function() {
                alert("Code copied!");
            })
            .catch(function() {
                alert(
                    "Copy failed. Long-press the code."
                );
            });
    } else {
        alert(
            "Your code is: " +
            connectionCode
        );
    }
}

/* =========================================================
   JOIN CONNECTION
   ========================================================= */

function showJoinConnection() {
    render(`
        <header>
            <div>
                <h1>Join</h1>
                <small>Enter the connection code</small>
            </div>
        </header>

        <main>

            <h2>🔢 Enter Code</h2>

            <p>
                Enter the 10-character code
                shown on the other phone.
            </p>

            <input
                class="search"
                id="connectionCodeInput"
                maxlength="10"
                placeholder="XXXXXXXXXX"
                autocomplete="off"
                style="
                    text-align:center;
                    font-size:24px;
                    letter-spacing:4px;
                    text-transform:uppercase;
                "
            >

            <button
                class="primary-btn"
                onclick="joinConnection()"
            >
                🔗 Connect
            </button>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                ← Back
            </button>

        </main>
    `);
}

function joinConnection() {
    const input =
        document.getElementById(
            "connectionCodeInput"
        );

    if (!input) {
        return;
    }

    const code =
        input.value
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{10}$/.test(code)
    ) {
        alert(
            "The connection code must be exactly 10 letters/numbers."
        );

        return;
    }

    if (!serverConnected) {
        alert(
            "VedChat server is not connected."
        );

        return;
    }

    connectionCode =
        code;

    sendServerMessage({
        type: "join",
        action: "join",
        code: code,
        name: getDisplayName(),
        username: getUsername(),
        status: getStatus()
    });

    sendServerMessage({
        type: "join-room",
        code: code,
        name: getDisplayName(),
        username: getUsername()
    });

    alert(
        "Connecting..."
    );
}

/* =========================================================
   DISCONNECT
   ========================================================= */

function disconnectUser() {
    if (
        !confirm(
            "Disconnect from this user?"
        )
    ) {
        return;
    }

    if (callState !== "idle") {
        endCall(true);
    }

    sendServerMessage({
        type: "leave",
        action: "leave",
        code: connectionCode
    });

    closePeerConnection();

    connectionState =
        "disconnected";

    connectionCode = "";
    remotePeerId = null;

    showHome();
}

/* =========================================================
   WEBRTC
   ========================================================= */

function createPeerConnection() {
    closePeerConnection();

    peerConnection =
        new RTCPeerConnection({
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
        });

    peerConnection.onicecandidate =
        function(event) {
            if (event.candidate) {
                sendSignal({
                    type: "ice",
                    candidate:
                        event.candidate
                });
            }
        };

    peerConnection.onconnectionstatechange =
        function() {
            if (!peerConnection) {
                return;
            }

            const state =
                peerConnection.connectionState;

            console.log(
                "WebRTC state:",
                state
            );

            if (
                state === "connected"
            ) {
                connectionState =
                    "connected";
            }

            if (
                state === "failed" ||
                state === "disconnected" ||
                state === "closed"
            ) {
                if (
                    callState !== "idle"
                ) {
                    endCall(false);
                }
            }
        };

    peerConnection.ontrack =
        function(event) {
            if (
                event.streams &&
                event.streams[0]
            ) {
                remoteStream =
                    event.streams[0];

                playRemoteAudio(
                    remoteStream
                );
            }
        };

    return peerConnection;
}

/* =========================================================
   WEBRTC SIGNAL
   ========================================================= */

function sendSignal(data) {
    sendServerMessage({
        type: "signal",
        signal: data,
        code: connectionCode,
        target: remotePeerId,
        sender: myPeerId
    });
}

async function handleWebRTCSignal(message) {
    const signal =
        message.signal ||
        message;

    if (!signal) {
        return;
    }

    try {
        if (
            signal.type === "offer"
        ) {
            await handleWebRTCOffer(
                signal
            );

            return;
        }

        if (
            signal.type === "answer"
        ) {
            await handleWebRTCAnswer(
                signal
            );

            return;
        }

        if (
            signal.type === "ice"
        ) {
            await handleWebRTCIce(
                signal
            );

            return;
        }
    } catch (error) {
        console.error(
            "WebRTC signaling error:",
            error
        );
    }
}

/* =========================================================
   WEBRTC OFFER
   ========================================================= */

async function handleWebRTCOffer(signal) {
    if (!peerConnection) {
        createPeerConnection();
    }

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(
            signal.offer ||
            signal
        )
    );

    const answer =
        await peerConnection.createAnswer();

    await peerConnection.setLocalDescription(
        answer
    );

    sendSignal({
        type: "answer",
        answer: answer
    });
}

/* =========================================================
   WEBRTC ANSWER
   ========================================================= */

async function handleWebRTCAnswer(signal) {
    if (!peerConnection) {
        return;
    }

    const answer =
        signal.answer ||
        signal;

    await peerConnection.setRemoteDescription(
        new RTCSessionDescription(
            answer
        )
    );
}

/* =========================================================
   WEBRTC ICE
   ========================================================= */

async function handleWebRTCIce(signal) {
    if (
        !peerConnection ||
        !signal.candidate
    ) {
        return;
    }

    try {
        await peerConnection.addIceCandidate(
            new RTCIceCandidate(
                signal.candidate
            )
        );
    } catch (error) {
        console.error(
            "ICE error:",
            error
        );
    }
}

/* =========================================================
   START REAL VOICE CALL
   ========================================================= */

function startCallFromChat() {
    const chats =
        getChats();

    const chat =
        chats[currentChat];

    const targetName =
        chat
            ? chat.name
            : "User";

    startOutgoingCall(
        targetName
    );
}

async function startOutgoingCall(targetName) {
    if (
        !serverConnected ||
        connectionState !== "connected"
    ) {
        alert(
            "Connect to another VedChat user first."
        );

        return;
    }

    if (callState !== "idle") {
        alert(
            "A call is already active."
        );

        return;
    }

    try {
        localStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true,
                    video: false
                }
            );

        createPeerConnection();

        localStream
            .getTracks()
            .forEach(function(track) {
                peerConnection.addTrack(
                    track,
                    localStream
                );
            });

        currentCallId =
            randomId();

        callState =
            "calling";

        callSeconds = 0;

        sendServerMessage({
            type: "call",
            action: "offer",
            callId: currentCallId,
            caller: getDisplayName(),
            target: targetName,
            code: connectionCode
        });

        const offer =
            await peerConnection.createOffer();

        await peerConnection.setLocalDescription(
            offer
        );

        sendSignal({
            type: "offer",
            offer: offer
        });

        showCallingScreen(
            targetName
        );

        startRingtone();

        setTimeout(function() {
            if (
                callState === "calling"
            ) {
                timeoutOutgoingCall();
            }
        }, 30000);

    } catch (error) {
        console.error(
            "Microphone error:",
            error
        );

        alert(
            "Microphone permission is required for voice calls."
        );

        closeLocalStream();
    }
}

/* =========================================================
   INCOMING CALL
   ========================================================= */

function handleCallSignal(message) {
    if (!message) {
        return;
    }

    if (
        message.action === "offer"
    ) {
        handleIncomingCall(
            message
        );

        return;
    }

    if (
        message.action === "answer"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        stopRingtone();

        callState =
            "connected";

        startCallTimer();

        return;
    }

    if (
        message.action === "decline"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        stopRingtone();

        callState =
            "idle";

        renderCallEnded(
            "Call declined",
            message.user ||
            "User"
        );

        return;
    }

    if (
        message.action === "timeout"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        stopRingtone();

        callState =
            "idle";

        speakNotAnswered(
            getDisplayName(),
            message.caller ||
            "User"
        );

        renderCallEnded(
            "No answer",
            message.caller ||
            "User"
        );

        return;
    }

    if (
        message.action === "end"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        endCall(false);
    }
}

/* =========================================================
   HANDLE INCOMING CALL
   ========================================================= */

function handleIncomingCall(message) {
    if (
        callState !== "idle"
    ) {
        sendServerMessage({
            type: "call",
            action: "busy",
            callId:
                message.callId,
            user:
                getDisplayName()
        });

        return;
    }

    currentCallId =
        message.callId;

    incomingCaller =
        message.caller ||
        "User";

    remotePeerId =
        message.sender ||
        remotePeerId;

    callState =
        "incoming";

    startRingtone();

    showIncomingCallScreen(
        incomingCaller
    );
}

/* =========================================================
   ANSWER CALL
   ========================================================= */

async function answerCall() {
    stopRingtone();

    try {
        localStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true,
                    video: false
                }
            );

        createPeerConnection();

        localStream
            .getTracks()
            .forEach(function(track) {
                peerConnection.addTrack(
                    track,
                    localStream
                );
            });

        callState =
            "connected";

        callSeconds = 0;

        sendServerMessage({
            type: "call",
            action: "answer",
            callId:
                currentCallId,
            answerer:
                getDisplayName()
        });

        showActiveCallScreen(
            incomingCaller
        );

        startCallTimer();

    } catch (error) {
        console.error(
            error
        );

        alert(
            "Microphone permission is required to answer the call."
        );

        declineCall();
    }
}

/* =========================================================
   DECLINE CALL
   ========================================================= */

function declineCall() {
    stopRingtone();

    sendServerMessage({
        type: "call",
        action: "decline",
        callId:
            currentCallId,
        user:
            getDisplayName()
    });

    callState =
        "idle";

    currentCallId =
        null;

    incomingCaller =
        "";

    closeLocalStream();

    showHome();
}

/* =========================================================
   OUTGOING TIMEOUT
   ========================================================= */

function timeoutOutgoingCall() {
    if (
        callState !== "calling"
    ) {
        return;
    }

    stopRingtone();

    sendServerMessage({
        type: "call",
        action: "timeout",
        callId:
            currentCallId,
        caller:
            getDisplayName()
    });

    callState =
        "idle";

    speakNotAnswered(
        getDisplayName(),
        "The user"
    );

    renderCallEnded(
        "Not answered",
        "The user"
    );
}

/* =========================================================
   CALLING SCREEN
   ========================================================= */

function showCallingScreen(user) {
    render(`
        <header>
            <div>
                <h1>Calling</h1>
                <small>VedChat Voice Call</small>
            </div>

            <span class="offline">
                CALLING
            </span>
        </header>

        <main style="text-align:center;">

            <div
                class="avatar"
                style="
                    width:110px;
                    height:110px;
                    margin:30px auto;
                    font-size:45px;
                "
            >
                ${escapeHTML(
                    String(user || "U")
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    user || "User"
                )}
            </h2>

            <p id="callStatus">
                📞 Calling...
            </p>

            <div
                id="callTimer"
                style="
                    font-size:20px;
                    margin:20px;
                "
            >
                00:00
            </div>

            <button
                class="danger-btn"
                onclick="cancelOutgoingCall()"
            >
                📵 Cancel
            </button>

        </main>
    `);
}

/* =========================================================
   INCOMING CALL SCREEN
   ========================================================= */

function showIncomingCallScreen(caller) {
    render(`
        <header>
            <div>
                <h1>Incoming Call</h1>
                <small>VedChat Voice Call</small>
            </div>

            <span class="offline">
                📞 INCOMING
            </span>
        </header>

        <main style="text-align:center;">

            <div
                class="avatar"
                style="
                    width:110px;
                    height:110px;
                    margin:30px auto;
                    font-size:45px;
                "
            >
                ${escapeHTML(
                    String(caller || "U")
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    caller || "User"
                )}
            </h2>

            <p>
                📞 Incoming voice call...
            </p>

            <button
                class="primary-btn"
                onclick="answerCall()"
            >
                📞 Answer
            </button>

            <button
                class="danger-btn"
                onclick="declineCall()"
            >
                ❌ Decline
            </button>

        </main>
    `);
}

/* =========================================================
   ACTIVE CALL
   ========================================================= */

function showActiveCallScreen(user) {
    render(`
        <header>
            <div>
                <h1>Voice Call</h1>
                <small>VedChat</small>
            </div>

            <span class="offline">
                🟢 CONNECTED
            </span>
        </header>

        <main style="text-align:center;">

            <div
                class="avatar"
                style="
                    width:110px;
                    height:110px;
                    margin:30px auto;
                    font-size:45px;
                "
            >
                ${escapeHTML(
                    String(user || "U")
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    user || "User"
                )}
            </h2>

            <p>
                🟢 Voice connected
            </p>

            <div
                id="callTimer"
                style="
                    font-size:20px;
                    margin:20px;
                "
            >
                00:00
            </div>

            <button
                class="secondary-btn"
                onclick="toggleCallMute()"
                id="muteCallButton"
            >
                🎤 Mute
            </button>

            <button
                class="danger-btn"
                onclick="endCall(true)"
            >
                📵 End Call
            </button>

        </main>
    `);
}

/* =========================================================
   CALL TIMER
   ========================================================= */

function startCallTimer() {
    stopCallTimer();

    callSeconds = 0;

    callTimer =
        setInterval(function() {
            callSeconds++;

            const timer =
                document.getElementById(
                    "callTimer"
                );

            if (!timer) {
                return;
            }

            const minutes =
                Math.floor(
                    callSeconds / 60
                )
                    .toString()
                    .padStart(2, "0");

            const seconds =
                (
                    callSeconds % 60
                )
                    .toString()
                    .padStart(2, "0");

            timer.textContent =
                minutes +
                ":" +
                seconds;

        }, 1000);
}

function stopCallTimer() {
    if (callTimer) {
        clearInterval(
            callTimer
        );

        callTimer = null;
    }
}

/* =========================================================
   END CALL
   ========================================================= */

function endCall(sendSignal = true) {
    if (
        sendSignal &&
        currentCallId
    ) {
        sendServerMessage({
            type: "call",
            action: "end",
            callId:
                currentCallId,
            user:
                getDisplayName()
        });
    }

    stopRingtone();
    stopCallTimer();
    closeLocalStream();
    closePeerConnection();

    callState =
        "idle";

    currentCallId =
        null;

    incomingCaller =
        "";

    callMuted =
        false;

    showHome();
}

function cancelOutgoingCall() {
    endCall(true);
}

/* =========================================================
   MUTE
   ========================================================= */

function toggleCallMute() {
    callMuted =
        !callMuted;

    if (localStream) {
        localStream
            .getAudioTracks()
            .forEach(function(track) {
                track.enabled =
                    !callMuted;
            });
    }

    const button =
        document.getElementById(
            "muteCallButton"
        );

    if (button) {
        button.textContent =
            callMuted
                ? "🔇 Unmute"
                : "🎤 Mute";
    }
}

/* =========================================================
   LOCAL MEDIA
   ========================================================= */

function closeLocalStream() {
    if (localStream) {
        localStream
            .getTracks()
            .forEach(function(track) {
                try {
                    track.stop();
                } catch (error) {}
            });

        localStream = null;
    }
}

function closePeerConnection() {
    if (peerConnection) {
        try {
            peerConnection.close();
        } catch (error) {}

        peerConnection =
            null;
    }

    remoteStream =
        null;
}

function playRemoteAudio(stream) {
    let audio =
        document.getElementById(
            "remoteAudio"
        );

    if (!audio) {
        audio =
            document.createElement(
                "audio"
            );

        audio.id =
            "remoteAudio";

        audio.autoplay =
            true;

        audio.playsInline =
            true;

        audio.style.display =
            "none";

        document.body.appendChild(
            audio
        );
    }

    audio.srcObject =
        stream;

    audio.play().catch(
        function(error) {
            console.log(
                "Audio playback waiting for user interaction:",
                error
            );
        }
    );
}

/* =========================================================
   RINGTONE
   ========================================================= */

function startRingtone() {
    stopRingtone();

    try {
        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) {
            return;
        }

        ringtoneContext =
            new AudioContext();

        ringtoneGain =
            ringtoneContext.createGain();

        ringtoneOscillator =
            ringtoneContext.createOscillator();

        ringtoneOscillator.type =
            "sine";

        ringtoneOscillator.frequency.value =
            700;

        ringtoneGain.gain.value =
            0.08;

        ringtoneOscillator.connect(
            ringtoneGain
        );

        ringtoneGain.connect(
            ringtoneContext.destination
        );

        ringtoneOscillator.start();

        ringtoneContext.resume();

        ringtoneInterval =
            setInterval(
                function() {
                    if (
                        ringtoneOscillator &&
                        ringtoneContext
                    ) {
                        ringtoneOscillator.frequency.value =
                            ringtoneOscillator
                                .frequency
                                .value === 700
                                ? 900
                                : 700;
                    }
                },
                500
            );

    } catch (error) {
        console.log(
            "Ringtone unavailable:",
            error
        );
    }
}

function stopRingtone() {
    if (ringtoneInterval) {
        clearInterval(
            ringtoneInterval
        );

        ringtoneInterval =
            null;
    }

    try {
        if (ringtoneOscillator) {
            ringtoneOscillator.stop();
        }
    } catch (error) {}

    try {
        if (ringtoneContext) {
            ringtoneContext.close();
        }
    } catch (error) {}

    ringtoneOscillator =
        null;

    ringtoneGain =
        null;

    ringtoneContext =
        null;
}

/* =========================================================
   MESSAGE SOUND
   ========================================================= */

function playNotificationSound() {
    try {
        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) {
            return;
        }

        const context =
            new AudioContext();

        const oscillator =
            context.createOscillator();

        const gain =
            context.createGain();

        oscillator.type =
            "sine";

        oscillator.frequency.value =
            880;

        gain.gain.value =
            0.06;

        oscillator.connect(
            gain
        );

        gain.connect(
            context.destination
        );

        oscillator.start();

        setTimeout(
            function() {
                try {
                    oscillator.stop();
                    context.close();
                } catch (error) {}
            },
            150
        );

    } catch (error) {
        console.log(
            "Notification sound unavailable"
        );
    }
}

/* =========================================================
   TEXT TO SPEECH
   ========================================================= */

function speakNotAnswered(
    user1,
    user2
) {
    if (
        !("speechSynthesis" in window)
    ) {
        return;
    }

    const name1 =
        user1 ||
        "Dear user";

    const name2 =
        user2 ||
        "the user";

    const text =
        "Dear " +
        name1 +
        ", " +
        name2 +
        " is not answering. Please try later.";

    try {
        window.speechSynthesis.cancel();

        const speech =
            new SpeechSynthesisUtterance(
                text
            );

        speech.rate =
            0.9;

        speech.pitch =
            1;

        window.speechSynthesis.speak(
            speech
        );
    } catch (error) {
        console.error(
            "Speech error:",
            error
        );
    }
}

/* =========================================================
   CALLS PAGE
   ========================================================= */

function showCalls() {
    currentPage = "calls";

    render(`
        <header>
            <div>
                <h1>Calls</h1>
                <small>VedChat voice calls</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <div class="empty">
                📞<br><br>
                Your call history will appear here.
            </div>

            ${
                connectionState === "connected"
                    ? `
                        <button
                            class="primary-btn"
                            onclick="startCallFromChat()"
                        >
                            📞 Start Voice Call
                        </button>
                    `
                    : `
                        <button
                            class="primary-btn"
                            onclick="showConnection()"
                        >
                            🔗 Connect Someone
                        </button>
                    `
            }

        </main>

        ${bottomNav("calls")}
    `);
}

/* =========================================================
   PROFILE
   ========================================================= */

function showProfile() {
    currentPage = "profile";

    const displayName =
        getDisplayName();

    const username =
        getUsername();

    const status =
        getStatus();

    const firstLetter =
        displayName
            .charAt(0)
            .toUpperCase();

    render(`
        <header>
            <div>
                <h1>Profile</h1>
                <small>Your VedChat profile</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <div class="profile-card">

                <div class="avatar">
                    ${escapeHTML(
                        firstLetter ||
                        "U"
                    )}
                </div>

                <h2>
                    ${escapeHTML(
                        displayName
                    )}
                </h2>

                <p>
                    ${
                        username
                            ? "@"
                                +
                                escapeHTML(
                                    username
                                )
                            : "@username"
                    }
                </p>

                <p>
                    ${escapeHTML(
                        status
                    )}
                </p>

            </div>

            <button
                class="primary-btn"
                onclick="editProfile()"
            >
                ✏️ Edit Profile
            </button>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                🔗 Connection
            </button>

            <button
                class="danger-btn"
                onclick="resetProfile()"
            >
                Reset Profile
            </button>

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>

        ${bottomNav("profile")}
    `);
}

/* =========================================================
   EDIT PROFILE
   ========================================================= */

function editProfile() {
    const username =
        prompt(
            "Username:",
            getUsername()
        );

    if (
        username === null
    ) {
        return;
    }

    const displayName =
        prompt(
            "Display name:",
            getDisplayName()
        );

    if (
        displayName === null
    ) {
        return;
    }

    if (
        !displayName.trim()
    ) {
        alert(
            "Display name cannot be empty."
        );

        return;
    }

    const status =
        prompt(
            "Status:",
            getStatus()
        );

    localStorage.setItem(
        "username",
        username.trim()
    );

    localStorage.setItem(
        "displayName",
        displayName.trim()
    );

    localStorage.setItem(
        "status",
        status === null
            ? getStatus()
            : status.trim()
    );

    /*
       Tell the server about
       the updated profile.
    */

    sendServerMessage({
        type: "profile",
        action: "update",
        name:
            getDisplayName(),
        username:
            getUsername(),
        status:
            getStatus()
    });

    showProfile();
}

/* =========================================================
   RESET PROFILE
   ========================================================= */

function resetProfile() {
    if (
        !confirm(
            "Reset your profile?"
        )
    ) {
        return;
    }

    localStorage.removeItem(
        "displayName"
    );

    localStorage.removeItem(
        "username"
    );

    localStorage.removeItem(
        "status"
    );

    showFirstProfileSetup();
}

/* =========================================================
   SETTINGS
   ========================================================= */

function showSettings() {
    currentPage =
        "settings";

    const dark =
        localStorage.getItem(
            "darkMode"
        ) === "true";

    render(`
        <header>
            <div>
                <h1>Settings</h1>
                <small>VedChat settings</small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <div class="setting">

                <div class="setting-title">
                    🌙 Dark Mode
                </div>

                <div class="setting-description">
                    Change the appearance of VedChat.
                </div>

                <button
                    class="secondary-btn"
                    onclick="toggleDarkMode()"
                >
                    ${
                        dark
                            ? "☀️ Turn Off"
                            : "🌙 Turn On"
                    }
                </button>

            </div>

            <div class="setting">

                <div class="setting-title">
                    🔊 Sounds
                </div>

                <div class="setting-description">
                    Message notifications and
                    incoming calls use local sounds.
                </div>

            </div>

            <div class="setting">

                <div class="setting-title">
                    📞 Voice Calling
                </div>

                <div class="setting-description">
                    VedChat uses WebRTC for
                    real-time voice communication.
                </div>

            </div>

            <div class="setting">

                <div class="setting-title">
                    🌐 Server
                </div>

                <div class="setting-description">
                    ${escapeHTML(
                        getServerURL()
                    )}
                </div>

            </div>

            <button
                class="secondary-btn"
                onclick="showProfile()"
            >
                👤 Profile
            </button>

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>

        ${bottomNav("settings")}
    `);
}

/* =========================================================
   BOTTOM NAV
   ========================================================= */

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
                    active === "calls"
                        ? "active"
                        : ""
                }"
                onclick="showCalls()"
            >
                📞
                <span>Calls</span>
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
                <span>Profile</span>
            </button>

        </nav>
    `;
}

/* =========================================================
   RENDER
   ========================================================= */

function render(content) {
    const app =
        document.getElementById(
            "app"
        );

    if (!app) {
        return;
    }

    app.innerHTML = `
        <div class="app">
            ${content}
        </div>
    `;
}

/* =========================================================
   START APPLICATION
   ========================================================= */

startApp();