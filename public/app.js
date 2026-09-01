/* =====================================================
   VEDCHAT V3 CLIENT
===================================================== */

"use strict";

/* =====================================================
   STATE
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
    loadJSON(
        "vedchat_private_messages",
        {}
    );

let groupMessages =
    loadJSON(
        "vedchat_group_messages",
        {}
    );

let callHistory =
    loadJSON(
        "vedchat_call_history",
        []
    );

let peerConnections = {};

let pendingCandidates = {};

let localStream = null;

let incomingCall = null;

let currentCall = null;

let reconnectTimer = null;

let heartbeatTimer = null;

/* Image transfers are sent through the existing chat WebSocket
   message types, so the server.js file does not need to change. */
let imageTransfers = {};
const IMAGE_CHUNK_SIZE = 3500;
const MAX_CHAT_IMAGE_BYTES = 1200 * 1024;

let offlineQueue = loadJSON("vedchat_offline_queue", []);
const MAX_OFFLINE_QUEUE = 1200;

/* =====================================================
   STORAGE
===================================================== */

function loadJSON(key, fallback) {
    try {
        const value =
            localStorage.getItem(key);

        if (!value) {
            return fallback;
        }

        return JSON.parse(value);
    } catch {
        return fallback;
    }
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

    localStorage.setItem(
        "vedchat_offline_queue",
        JSON.stringify(offlineQueue)
    );
}

/* =====================================================
   HTML SAFETY
===================================================== */

function escapeHTML(value) {
    const div =
        document.createElement("div");

    div.textContent =
        String(value ?? "");

    return div.innerHTML;
}

/* =====================================================
   AVATAR
===================================================== */

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
                alt=""
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
        location.protocol === "https:"
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
   CONNECTION
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

    updateStatus(false);

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

        updateStatus(false);

        createAccountIfNeeded();

        sendRaw({
            type: "register",
            code: myCode,
            name: myName,
            avatar: myAvatar
        });

        startHeartbeat();
        setTimeout(flushOfflineQueue, 150);
    };

    ws.onclose = () => {
        connectionState =
            "offline";

        stopHeartbeat();

        updateStatus(false);

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

            handleMessage(message);
        } catch (error) {
            console.error(
                "Message parse error:",
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
        }, 2500);
}

function startHeartbeat() {
    stopHeartbeat();

    heartbeatTimer =
        setInterval(() => {
            sendRaw({
                type: "ping"
            });
        }, 20000);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(
            heartbeatTimer
        );

        heartbeatTimer = null;
    }
}

function sendRaw(data) {
    if (
        ws &&
        ws.readyState ===
            WebSocket.OPEN
    ) {
        try {
            ws.send(
                JSON.stringify(data)
            );

            return true;
        } catch (error) {
            console.error(error);
        }
    }

    return false;
}

function makeClientMessageId() {
    return cryptoRandomId();
}

function queueOfflineMessage(data) {
    if (!data || typeof data !== "object") return false;

    offlineQueue.push({
        ...data,
        clientId: data.clientId || makeClientMessageId(),
        queuedAt: new Date().toISOString()
    });

    if (offlineQueue.length > MAX_OFFLINE_QUEUE) {
        offlineQueue.splice(0, offlineQueue.length - MAX_OFFLINE_QUEUE);
    }

    saveLocal();
    return true;
}

function flushOfflineQueue() {
    if (connectionState !== "connected" || !offlineQueue.length) return;

    const queue = offlineQueue.slice();
    offlineQueue = [];
    saveLocal();

    for (const item of queue) {
        const data = { ...item };
        delete data.queuedAt;
        if (!sendRaw(data)) {
            offlineQueue.push(item);
            break;
        }
    }

    if (offlineQueue.length > MAX_OFFLINE_QUEUE) {
        offlineQueue.splice(0, offlineQueue.length - MAX_OFFLINE_QUEUE);
    }

    saveLocal();
    updateOfflineQueueStatus();
}

function updateOfflineQueueStatus() {
    const badge = document.getElementById("offlineQueueBadge");
    if (!badge) return;
    badge.textContent = offlineQueue.length ? `${offlineQueue.length} pending` : "";
    badge.style.display = offlineQueue.length ? "inline-block" : "none";
}

function send(data, options = {}) {
    if (sendRaw(data)) return true;

    if (options.queue === true) {
        queueOfflineMessage(data);
        updateOfflineQueueStatus();
        return false;
    }

    alert("VedChat is not connected.");
    return false;
}

/* =====================================================
   RINGTONE + NOTIFICATIONS
===================================================== */

let ringtoneTimer = null;
let audioContext = null;

function ensureNotificationPermission() {
    if ("Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch {}
    }
}

function playNotificationSound(kind = "message") {
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioContext = audioContext || new AC();
        if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
        const now = audioContext.currentTime;
        const notes = kind === "call" ? [660, 880, 660] : [880, 660];
        notes.forEach((freq, i) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();
            osc.type = kind === "call" ? "sine" : "triangle";
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.0001, now + i * 0.16);
            gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.16 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.14);
            osc.connect(gain); gain.connect(audioContext.destination);
            osc.start(now + i * 0.16); osc.stop(now + i * 0.16 + 0.15);
        });
    } catch (e) { console.warn("Sound unavailable", e); }
}

function startRingtone() {
    stopRingtone();
    playNotificationSound("call");
    ringtoneTimer = setInterval(() => playNotificationSound("call"), 1300);
}

function stopRingtone() {
    if (ringtoneTimer) { clearInterval(ringtoneTimer); ringtoneTimer = null; }
}

function showNotification(title, body, kind = "message") {
    playNotificationSound(kind);
    if (document.visibilityState === "visible") return;
    if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification(title, { body, icon: "/icon.png", tag: "vedchat-" + kind }); } catch {}
    }
}

/* =====================================================
   SERVER MESSAGES
===================================================== */

function handleMessage(message) {
    if (
        !message ||
        typeof message !== "object"
    ) {
        return;
    }

    switch (message.type) {
        case "server-ready":
            break;

        case "registered":
            handleRegistered(message);
            break;

        case "profile-updated":
            handleProfileUpdated(
                message
            );
            break;

        case "friend-profile-updated":
            handleFriendProfileUpdated(
                message
            );
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
            updatePresence(
                message
            );
            break;

        case "user-found":
            showFoundUser(
                message.user
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
            addGroupLocally(
                message.group
            );

            if (
                currentPage ===
                "groups"
            ) {
                showGroups();
            }

            break;

        case "group-joined":
            addGroupLocally(
                message.group
            );

            if (
                currentPage ===
                "groups"
            ) {
                showGroups();
            }

            break;

        case "group-member-joined":
            break;

        case "group-chat":
            receiveGroupMessage(
                message
            );
            break;

        /* CALLING */

        case "call-invite":
            receiveIncomingCall(
                message
            );
            break;

        case "call-offer":
            receiveCallOffer(
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
            handleCallDecline(
                message
            );
            break;

        case "call-end":
            handleRemoteCallEnd(
                message
            );
            break;

        case "call-leave":
            handleRemoteCallLeave(
                message
            );
            break;

        case "pong":
            break;

        case "error":
            console.warn(
                "Server error:",
                message.message
            );

            alert(
                message.message ||
                "Server error."
            );

            break;

        default:
            /*
             * IMPORTANT:
             * Unknown messages are ignored safely.
             * This prevents an old/extra message from
             * destroying the UI.
             */

            console.warn(
                "Ignored unknown server message:",
                message
            );

            break;
    }
}

/* =====================================================
   REGISTERED
===================================================== */

function handleRegistered(message) {
    myCode =
        message.code || myCode;

    myName =
        message.name || myName;

    myAvatar =
        message.avatar || myAvatar;

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

    getFriends();
    getGroups();

    if (
        currentPage ===
        "home"
    ) {
        showHome();
    }
}

/* =====================================================
   PROFILE
===================================================== */

function handleProfileUpdated(
    message
) {
    myName =
        message.name || myName;

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
}

function handleFriendProfileUpdated(
    message
) {
    if (!message.user) return;

    friends =
        friends.map(friend =>
            friend.code ===
            message.user.code
                ? {
                    ...friend,
                    ...message.user
                }
                : friend
        );

    if (
        currentPage ===
        "friends"
    ) {
        showFriends();
    }
}

function createAccountIfNeeded() {
    if (myName) return;

    let name =
        prompt(
            "Choose your VedChat display name:"
        );

    name =
        String(name || "")
            .trim()
            .slice(0, 40);

    if (!name) {
        name = "Guest";
    }

    myName = name;

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
        name:
            name.trim(),
        avatar:
            myAvatar
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
                2 * 1024 * 1024
            ) {
                alert(
                    "Please choose an image smaller than 2 MB."
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
    currentPage = "home";

    render(`
        <header class="topbar">
            <div>
                <h1>VedChat</h1>
                <small>
                    Fast private communication
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

            <section class="hero-card">

                <div class="hero-avatar">
                    ${avatarHTML(
                        myAvatar,
                        myName,
                        70
                    )}
                </div>

                <div class="hero-info">

                    <h2>
                        Hi, ${escapeHTML(myName)} 👋
                    </h2>

                    <div class="connection">
                        <span class="${
                            connectionState ===
                            "connected"
                                ? "dot online-dot"
                                : "dot"
                        }"></span>

                        ${
                            connectionState ===
                            "connected"
                                ? "Connected"
                                : connectionState ===
                                  "connecting"
                                    ? "Connecting..."
                                    : "Offline"
                        }
                    </div>

                </div>

            </section>

            <section class="code-card">

                <span>
                    Your VedChat code
                </span>

                <strong>
                    ${escapeHTML(
                        myCode ||
                        "CREATING..."
                    )}
                </strong>

                <button
                    class="secondary-btn"
                    onclick="copyCode()"
                >
                    📋 Copy code
                </button>

            </section>

            <div class="quick-grid">

                <button
                    class="quick-card"
                    onclick="showChats()"
                >
                    <span>💬</span>
                    <strong>Chats</strong>
                    <small>
                        Messages
                    </small>
                </button>

                <button
                    class="quick-card"
                    onclick="showFriends()"
                >
                    <span>🧑‍🤝‍🧑</span>
                    <strong>Friends</strong>
                    <small>
                        ${friends.length} friends
                    </small>
                </button>

                <button
                    class="quick-card"
                    onclick="showGroups()"
                >
                    <span>👥</span>
                    <strong>Groups</strong>
                    <small>
                        ${groups.length} groups
                    </small>
                </button>

                <button
                    class="quick-card"
                    onclick="showConnect()"
                >
                    <span>🔗</span>
                    <strong>Connect</strong>
                    <small>
                        Add someone
                    </small>
                </button>

            </div>

            <button
                class="wide-action"
                onclick="showCallHistory()"
            >
                📞
                <div>
                    <strong>Call History</strong>
                    <small>
                        View your recent calls
                    </small>
                </div>
                <span>›</span>
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

    if (
        navigator.clipboard
    ) {
        navigator.clipboard
            .writeText(myCode)
            .then(() =>
                alert(
                    "VedChat code copied!"
                )
            )
            .catch(() =>
                alert(
                    "Your code is: " +
                    myCode
                )
            );
    } else {
        alert(
            "Your code is: " +
            myCode
        );
    }
}

/* =====================================================
   CONNECT
===================================================== */

function showConnect() {
    currentPage =
        "connect";

    render(`
        <header class="topbar">
            <div>
                <h1>Connect</h1>
                <small>
                    Add a VedChat friend
                </small>
            </div>
        </header>

        <main>

            <section class="card">

                <div class="section-heading">
                    <span>🔢</span>
                    <div>
                        <h2>Connection code</h2>
                        <p>
                            Enter their 10-character code.
                        </p>
                    </div>
                </div>

                <input
                    id="friendCode"
                    class="big-input"
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

            </section>

            <section class="card">

                <div class="section-heading">
                    <span>📷</span>
                    <div>
                        <h2>Scan QR</h2>
                        <p>
                            Scan a friend's VedChat code.
                        </p>
                    </div>
                </div>

                <button
                    class="secondary-btn"
                    onclick="startQRScanner()"
                >
                    📷 Open Camera Scanner
                </button>

                <div id="scanner"></div>

            </section>

            <section class="card qr-card">

                <div class="section-heading">
                    <span>🔳</span>
                    <div>
                        <h2>Your QR code</h2>
                        <p>
                            Let a friend scan this.
                        </p>
                    </div>
                </div>

                <div
                    id="myQR"
                    class="qr-box"
                ></div>

            </section>

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

function showFoundUser(user) {
    const app =
        document.getElementById(
            "app"
        );

    if (!app || !user) return;

    const main =
        app.querySelector("main");

    if (!main) return;

    const old =
        document.getElementById(
            "foundUserCard"
        );

    if (old) {
        old.remove();
    }

    const card =
        document.createElement(
            "section"
        );

    card.id =
        "foundUserCard";

    card.className =
        "card found-user";

    const alreadyFriend =
        friends.some(
            friend =>
                friend.code ===
                user.code
        );

    card.innerHTML = `
        ${avatarHTML(
            user.avatar,
            user.name,
            74
        )}

        <div class="found-info">

            <h2>
                ${escapeHTML(user.name)}
            </h2>

            <p>
                ${
                    user.online
                        ? "🟢 Online"
                        : "⚪ Offline"
                }
            </p>

            <small>
                ${escapeHTML(user.code)}
            </small>

        </div>

        ${
            alreadyFriend
                ? `
                    <button
                        class="secondary-btn"
                        onclick="openPrivateChat(
                            '${escapeHTML(user.code)}'
                        )"
                    >
                        💬 Open Chat
                    </button>
                `
                : `
                    <button
                        class="primary-btn"
                        onclick="addFriend(
                            '${escapeHTML(user.code)}'
                        )"
                    >
                        🧑‍🤝‍🧑 Add Friend
                    </button>
                `
        }
    `;

    main.appendChild(card);
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
                width: 210,
                height: 210
            }
        );
    } else {
        box.innerHTML = `
            <div class="qr-fallback">
                ${escapeHTML(myCode)}
            </div>
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
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        scanner.innerHTML = `
            <div class="warning">
                Camera access is not available.
                Enter the code manually instead.
            </div>
        `;

        return;
    }

    if (
        !("BarcodeDetector" in window)
    ) {
        scanner.innerHTML = `
            <div class="warning">
                QR scanning is not supported
                by this browser.
                Please enter the code manually.
            </div>
        `;

        return;
    }

    let stream = null;

    try {
        stream =
            await navigator.mediaDevices
                .getUserMedia({
                    video: {
                        facingMode:
                            "environment"
                    },
                    audio: false
                });

        scanner.innerHTML = `
            <video
                id="qrVideo"
                class="scanner-video"
                autoplay
                playsinline
            ></video>

            <button
                class="danger-btn"
                onclick="stopQRScanner()"
            >
                ✕ Stop Scanner
            </button>
        `;

        const video =
            document.getElementById(
                "qrVideo"
            );

        video.srcObject =
            stream;

        window.currentQRStream =
            stream;

        const detector =
            new BarcodeDetector({
                formats: [
                    "qr_code"
                ]
            });

        const scan =
            async () => {
                if (
                    !window.currentQRStream
                ) {
                    return;
                }

                if (
                    video.readyState >=
                    2
                ) {
                    try {
                        const codes =
                            await detector.detect(
                                video
                            );

                        if (
                            codes.length
                        ) {
                            const value =
                                String(
                                    codes[0]
                                        .rawValue ||
                                    ""
                                )
                                    .trim()
                                    .toUpperCase();

                            stopQRScanner();

                            if (
                                value.length ===
                                10
                            ) {
                                const input =
                                    document.getElementById(
                                        "friendCode"
                                    );

                                if (input) {
                                    input.value =
                                        value;

                                    lookupFriend();
                                }
                            } else {
                                alert(
                                    "That QR code is not a VedChat code."
                                );
                            }

                            return;
                        }
                    } catch {}
                }

                requestAnimationFrame(
                    scan
                );
            };

        scan();

    } catch (error) {
        console.error(error);

        if (stream) {
            stream
                .getTracks()
                .forEach(
                    track =>
                        track.stop()
                );
        }

        scanner.innerHTML = `
            <div class="warning">
                Camera permission was denied
                or the camera could not be opened.
            </div>
        `;
    }
}

function stopQRScanner() {
    if (
        window.currentQRStream
    ) {
        window.currentQRStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );
    }

    window.currentQRStream =
        null;

    const scanner =
        document.getElementById(
            "scanner"
        );

    if (scanner) {
        scanner.innerHTML = "";
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

function updatePresence(message) {
    friends =
        friends.map(friend =>
            friend.code ===
            message.code
                ? {
                    ...friend,
                    online:
                        !!message.online
                }
                : friend
        );

    if (
        currentPage ===
        "friends"
    ) {
        showFriends();
    }
}

function showFriends() {
    currentPage =
        "friends";

    render(`
        <header class="topbar">
            <div>
                <h1>Friends</h1>
                <small>
                    ${friends.length}
                    friend${
                        friends.length === 1
                            ? ""
                            : "s"
                    }
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="showConnect()"
            >
                ＋
            </button>
        </header>

        <main>

            <button
                class="primary-btn"
                onclick="showConnect()"
            >
                ➕ Add Friend
            </button>

            <div
                id="friendsList"
                class="list"
            ></div>

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
                <div class="empty-icon">
                    🧑‍🤝‍🧑
                </div>

                <h3>
                    No friends yet
                </h3>

                <p>
                    Add someone using
                    their VedChat code.
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
                    friend.name,
                    52
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
                    title="Chat"
                    onclick="event.stopPropagation(); openPrivateChat(
                        '${escapeHTML(friend.code)}'
                    )"
                >
                    💬
                </button>

                <button
                    class="small-action"
                    title="Call"
                    onclick="event.stopPropagation(); startPrivateCall(
                        '${escapeHTML(friend.code)}'
                    )"
                >
                    📞
                </button>
            `;

            item.onclick =
                () =>
                    openPrivateChat(
                        friend.code
                    );

            list.appendChild(
                item
            );
        }
    );
}

/* =====================================================
   IMAGE MESSAGES
===================================================== */

function isImageChunkText(text) {
    return typeof text === "string" && text.startsWith("__VEDCHAT_IMAGE__:");
}

function makeImageChunkText(payload) {
    return "__VEDCHAT_IMAGE__:" + JSON.stringify(payload);
}

function parseImageChunkText(text) {
    if (!isImageChunkText(text)) return null;

    try {
        return JSON.parse(text.slice("__VEDCHAT_IMAGE__:".length));
    } catch {
        return null;
    }
}

function imageTransferKey(scope, id, imageId) {
    return scope + ":" + id + ":" + imageId;
}

function receiveImageChunk(message, scope, conversationId) {
    const chunk = parseImageChunkText(message.text);
    if (!chunk || !chunk.id) return null;

    const total = Number(chunk.total);
    const index = Number(chunk.index);

    if (!Number.isFinite(total) || !Number.isFinite(index) || total < 1 || index < 0 || index >= total) {
        return null;
    }

    const key = imageTransferKey(scope, conversationId, chunk.id);

    if (!imageTransfers[key]) {
        imageTransfers[key] = {
            total,
            chunks: new Array(total),
            received: 0,
            name: String(chunk.name || "image").slice(0, 120),
            mime: String(chunk.mime || "image/jpeg").slice(0, 100),
            size: Number(chunk.size) || 0,
            time: message.time,
            sender: message.sender,
            avatar: message.avatar,
            from: message.from,
            to: message.to,
            groupId: message.groupId,
            clientId: message.clientId || chunk.clientId
        };
    }

    const transfer = imageTransfers[key];

    if (!transfer.chunks[index]) {
        transfer.chunks[index] = String(chunk.data || "");
        transfer.received++;
    }

    if (transfer.received < transfer.total) {
        return null;
    }

    const data = transfer.chunks.join("");
    delete imageTransfers[key];

    if (!data.startsWith("data:")) return null;
    if (data.length > 3 * 1024 * 1024) return null;

    return {
        ...message,
        text: "",
        image: {
            data,
            name: transfer.name,
            mime: transfer.mime,
            size: transfer.size
        }
    };
}

function imageMessageHTML(message) {
    if (!message || !message.image || !message.image.data) return "";

    return `
        <a
            class="chat-image-link"
            href="${escapeHTML(message.image.data)}"
            target="_blank"
            rel="noopener"
        >
            <img
                class="chat-image"
                src="${escapeHTML(message.image.data)}"
                alt="${escapeHTML(message.image.name || "Image")}"
                loading="lazy"
            >
        </a>
        <small class="image-name">
            ${escapeHTML(message.image.name || "Image")}
        </small>
    `;
}

function fileToCompressedDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onerror = () => reject(new Error("Could not read image."));
        reader.onload = () => {
            const img = new Image();

            img.onerror = () => reject(new Error("That image could not be opened."));
            img.onload = () => {
                const maxSide = 1280;
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const width = Math.max(1, Math.round(img.width * scale));
                const height = Math.max(1, Math.round(img.height * scale));

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Image processing is unavailable."));
                    return;
                }

                ctx.drawImage(img, 0, 0, width, height);

                let data = canvas.toDataURL("image/jpeg", 0.78);

                /* If the compressed image is still large, reduce quality a little. */
                if (data.length > MAX_CHAT_IMAGE_BYTES * 1.37) {
                    data = canvas.toDataURL("image/jpeg", 0.62);
                }

                if (data.length > MAX_CHAT_IMAGE_BYTES * 1.37) {
                    reject(new Error("Please choose a smaller image."));
                    return;
                }

                resolve(data);
            };

            img.src = String(reader.result || "");
        };

        reader.readAsDataURL(file);
    });
}

function sendImageInChunks(dataURL, fileName, mime, destination) {
    const total = Math.ceil(dataURL.length / IMAGE_CHUNK_SIZE);
    const imageId = cryptoRandomId();
    const size = Math.round((dataURL.length * 3) / 4);

    for (let index = 0; index < total; index++) {
        const data = dataURL.slice(index * IMAGE_CHUNK_SIZE, (index + 1) * IMAGE_CHUNK_SIZE);

        const payload = {
            id: imageId,
            index,
            total,
            name: String(fileName || "image.jpg").slice(0, 120),
            mime: String(mime || "image/jpeg").slice(0, 100),
            size,
            data
        };

        send({
            type: destination.type,
            to: destination.to,
            groupId: destination.groupId,
            text: makeImageChunkText(payload)
        });
    }
}

function chooseChatImage(kind) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = async event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please choose an image file.");
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            alert("Please choose an image smaller than 5 MB.");
            return;
        }

        try {
            const dataURL = await fileToCompressedDataURL(file);

            if (kind === "private") {
                if (!currentFriend) return;
                const total = Math.ceil(dataURL.length / IMAGE_CHUNK_SIZE);
                const imageId = cryptoRandomId();
                const clientId = makeClientMessageId();
                const size = Math.round((dataURL.length * 3) / 4);
                const localImage = {
                    data: dataURL,
                    name: file.name,
                    mime: file.type,
                    size
                };
                addLocalPendingPrivateMessage({
                    type: "private-chat",
                    to: currentFriend,
                    text: "",
                    clientId,
                    time: new Date().toISOString(),
                    image: localImage
                });
                for (let index = 0; index < total; index++) {
                    const payload = {
                        id: imageId, clientId, index, total,
                        name: String(file.name || "image.jpg").slice(0, 120),
                        mime: String(file.type || "image/jpeg").slice(0, 100),
                        size,
                        data: dataURL.slice(index * IMAGE_CHUNK_SIZE, (index + 1) * IMAGE_CHUNK_SIZE)
                    };
                    send({ type: "private-chat", to: currentFriend, text: makeImageChunkText(payload), clientId }, { queue: true });
                }
            } else if (kind === "group") {
                if (!currentGroup) return;
                const total = Math.ceil(dataURL.length / IMAGE_CHUNK_SIZE);
                const imageId = cryptoRandomId();
                const clientId = makeClientMessageId();
                const size = Math.round((dataURL.length * 3) / 4);
                addLocalPendingGroupMessage({
                    type: "group-chat",
                    groupId: currentGroup,
                    text: "",
                    clientId,
                    time: new Date().toISOString(),
                    image: { data: dataURL, name: file.name, mime: file.type, size }
                });
                for (let index = 0; index < total; index++) {
                    const payload = {
                        id: imageId, clientId, index, total,
                        name: String(file.name || "image.jpg").slice(0, 120),
                        mime: String(file.type || "image/jpeg").slice(0, 100),
                        size,
                        data: dataURL.slice(index * IMAGE_CHUNK_SIZE, (index + 1) * IMAGE_CHUNK_SIZE)
                    };
                    send({ type: "group-chat", groupId: currentGroup, text: makeImageChunkText(payload), clientId }, { queue: true });
                }
            }
        } catch (error) {
            console.error(error);
            alert(error.message || "Could not send that image.");
        }
    };

    input.click();
}

/* =====================================================
   PRIVATE CHAT
===================================================== */

function getPrivateMessages(code) {
    if (
        !privateMessages[code]
    ) {
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

    if (isImageChunkText(message.text)) {
        const complete = receiveImageChunk(message, "private", other);
        if (!complete) return;
        message = complete;
    }

    const messages =
        getPrivateMessages(other);

    if (message.clientId) {
        const existingIndex = messages.findIndex(m => m.clientId === message.clientId);
        if (existingIndex >= 0) {
            messages[existingIndex] = {
                ...messages[existingIndex],
                ...message,
                pending: false
            };
        } else {
            messages.push(message);
        }
    } else {
        messages.push(message);
    }

    if (message.from !== myCode && !(currentPage === "private-chat" && currentFriend === other)) {
        showNotification(
            message.sender || "New message",
            message.image ? "📷 Image" : (message.text || "New VedChat message"),
            "message"
        );
    }

    if (messages.length > 1000) {
        messages.splice(
            0,
            messages.length - 1000
        );
    }

    saveLocal();

    if (
        currentPage === "private-chat" &&
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

            ${avatarHTML(
                friend?.avatar || "",
                friend?.name || "User",
                44
            )}

            <div class="chat-title">

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
                            : "⚪ Offline"
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

                <span id="offlineQueueBadge" class="offline-queue-badge" style="display:none"></span>

                <button
                    class="attach-btn"
                    title="Send image"
                    onclick="chooseChatImage('private')"
                >
                    📷
                </button>

                <input
                    id="privateMessageInput"
                    placeholder="Message..."
                    maxlength="5000"
                    autocomplete="off"
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
                event.key === "Enter"
            ) {
                event.preventDefault();
                sendPrivateMessage();
            }
        }
    );

    displayPrivateMessages();
    updateOfflineQueueStatus();

    setTimeout(
        () => input?.focus(),
        100
    );
}

function addLocalPendingPrivateMessage(message) {
    const messages = getPrivateMessages(message.to);
    messages.push({
        ...message,
        from: myCode,
        sender: myName,
        time: message.time || new Date().toISOString(),
        pending: true
    });
    if (messages.length > 1000) messages.splice(0, messages.length - 1000);
    saveLocal();
    if (currentPage === "private-chat") displayPrivateMessages();
}

function sendPrivateMessage() {
    const input = document.getElementById("privateMessageInput");
    if (!input) return;

    const text = input.value.trim();
    if (!text || !currentFriend) return;

    const message = {
        type: "private-chat",
        to: currentFriend,
        text,
        clientId: makeClientMessageId(),
        time: new Date().toISOString()
    };

    addLocalPendingPrivateMessage(message);
    input.value = "";
    send(message, { queue: true });
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
                ${
                    !mine
                        ? `
                            <strong>
                                ${escapeHTML(
                                    message.sender ||
                                    ""
                                )}
                            </strong>
                        `
                        : ""
                }

                ${
                    message.image
                        ? imageMessageHTML(message)
                        : `<div>${escapeHTML(message.text || "")}</div>`
                }

                <span class="message-time">
                    ${formatTime(message.time)}${message.pending ? " • Pending" : ""}
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
                Recent chats
            </div>

            <div
                id="recentChats"
                class="list"
            ></div>

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
                <div class="empty-icon">
                    💬
                </div>

                <h3>
                    No chats yet
                </h3>

                <p>
                    Start a conversation
                    with a friend.
                </p>
            </div>
        `;

        return;
    }

    const sorted =
        codes.sort(
            (a, b) => {
                const am =
                    privateMessages[a] || [];

                const bm =
                    privateMessages[b] || [];

                const at =
                    am.length
                        ? new Date(
                            am[
                                am.length - 1
                            ].time
                        ).getTime()
                        : 0;

                const bt =
                    bm.length
                        ? new Date(
                            bm[
                                bm.length - 1
                            ].time
                        ).getTime()
                        : 0;

                return bt - at;
            }
        );

    sorted.forEach(
        code => {
            const messages =
                privateMessages[code] ||
                [];

            const last =
                messages[
                    messages.length - 1
                ];

            if (!last) return;

            const friend =
                friends.find(
                    f =>
                        f.code === code
                );

            const item =
                document.createElement(
                    "div"
                );

            item.className =
                "friend-item";

            item.onclick =
                () =>
                    openPrivateChat(
                        code
                    );

            item.innerHTML = `
                ${avatarHTML(
                    friend?.avatar || "",
                    friend?.name ||
                    last.sender ||
                    "User",
                    52
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
                            last.image ? "📷 Image" : (last.text || "")
                        )}
                    </small>

                </div>

                <small class="chat-time">
                    ${formatTime(
                        last.time
                    )}
                </small>
            `;

            list.appendChild(
                item
            );
        }
    );
}

/* =====================================================
   GROUPS
===================================================== */

function getGroups() {
    if (
        connectionState !==
        "connected"
    ) {
        return;
    }

    send({
        type: "get-groups"
    });
}

function addGroupLocally(group) {
    if (!group) return;

    if (
        !groups.some(
            g => g.id === group.id
        )
    ) {
        groups.push(group);
    }
}

function showGroups() {
    currentPage =
        "groups";

    render(`
        <header class="topbar">
            <div>
                <h1>Groups</h1>
                <small>
                    ${groups.length}
                    group${
                        groups.length === 1
                            ? ""
                            : "s"
                    }
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="createGroup()"
            >
                ＋
            </button>
        </header>

        <main>

            <button
                class="primary-btn"
                onclick="createGroup()"
            >
                ➕ Create Group
            </button>

            <div
                id="groupList"
                class="list"
            ></div>

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
                <div class="empty-icon">
                    👥
                </div>

                <h3>
                    No groups yet
                </h3>

                <p>
                    Create a group and
                    invite friends.
                </p>
            </div>
        `;

        return;
    }

    groups.forEach(
        group => {
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
                        ${
                            group.members.length
                        }
                        members
                    </small>

                </div>

                <span class="arrow">
                    ›
                </span>
            `;

            list.appendChild(
                item
            );
        }
    );
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
        name:
            name.trim()
    });
}

/* =====================================================
   GROUP CHAT
===================================================== */

function openGroupChat(
    groupId
) {
    const group =
        groups.find(
            item =>
                item.id ===
                groupId
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

            <div class="chat-title">

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

                <span id="offlineQueueBadge" class="offline-queue-badge" style="display:none"></span>

                <button
                    class="attach-btn"
                    title="Send image"
                    onclick="chooseChatImage('group')"
                >
                    📷
                </button>

                <input
                    id="groupMessageInput"
                    placeholder="Message group..."
                    maxlength="5000"
                    autocomplete="off"
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
                event.preventDefault();
                sendGroupMessage();
            }
        }
    );

    displayGroupMessages();
    updateOfflineQueueStatus();

    setTimeout(
        () => input?.focus(),
        100
    );
}

function addLocalPendingGroupMessage(message) {
    if (!groupMessages[message.groupId]) groupMessages[message.groupId] = [];
    groupMessages[message.groupId].push({
        ...message,
        from: myCode,
        sender: myName,
        time: message.time || new Date().toISOString(),
        pending: true
    });
    if (groupMessages[message.groupId].length > 1000) {
        groupMessages[message.groupId].splice(0, groupMessages[message.groupId].length - 1000);
    }
    saveLocal();
    if (currentPage === "group-chat") displayGroupMessages();
}

function sendGroupMessage() {
    const input = document.getElementById("groupMessageInput");
    if (!input) return;

    const text = input.value.trim();
    if (!text || !currentGroup) return;

    const message = {
        type: "group-chat",
        groupId: currentGroup,
        text,
        clientId: makeClientMessageId(),
        time: new Date().toISOString()
    };

    addLocalPendingGroupMessage(message);
    input.value = "";
    send(message, { queue: true });
}

function receiveGroupMessage(
    message
) {
    const groupId = message.groupId;
    if (!groupId) return;

    if (isImageChunkText(message.text)) {
        const complete = receiveImageChunk(message, "group", groupId);
        if (!complete) return;
        message = complete;
    }

    if (!groupMessages[groupId]) {
        groupMessages[groupId] = [];
    }

    if (message.clientId) {
        const existingIndex = groupMessages[groupId].findIndex(m => m.clientId === message.clientId);
        if (existingIndex >= 0) {
            groupMessages[groupId][existingIndex] = {
                ...groupMessages[groupId][existingIndex],
                ...message,
                pending: false
            };
        } else {
            groupMessages[groupId].push(message);
        }
    } else {
        groupMessages[groupId].push(message);
    }

    if (groupMessages[groupId].length > 1000) {
        groupMessages[groupId].splice(
            0,
            groupMessages[groupId].length - 1000
        );
    }

    if (message.from !== myCode && !(currentPage === "group-chat" && currentGroup === groupId)) {
        showNotification(
            message.sender || "New group message",
            message.image ? "📷 Image" : (message.text || "New VedChat message"),
            "message"
        );
    }

    saveLocal();

    if (
        currentPage === "group-chat" &&
        currentGroup === groupId
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
                ${
                    !mine
                        ? `
                            <strong>
                                ${escapeHTML(
                                    message.sender
                                )}
                            </strong>
                        `
                        : ""
                }

                ${
                    message.image
                        ? imageMessageHTML(message)
                        : `<div>${escapeHTML(message.text || "")}</div>`
                }

                <span class="message-time">
                    ${formatTime(message.time)}${message.pending ? " • Pending" : ""}
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
   WEBRTC
===================================================== */

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

async function getMicrophone() {
    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        throw new Error(
            "Microphone unavailable."
        );
    }

    return navigator.mediaDevices
        .getUserMedia({
            audio: true,
            video: false
        });
}

function createPeer(
    peerId,
    target,
    groupId = null
) {
    if (
        peerConnections[peerId]
    ) {
        try {
            peerConnections[
                peerId
            ].close();
        } catch {}
    }

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
                    target,
                    groupId,
                    callId:
                        currentCall?.callId,
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

                audio.controls =
                    false;

                document.body.appendChild(
                    audio
                );
            }

            if (
                event.streams &&
                event.streams[0]
            ) {
                audio.srcObject =
                    event.streams[0];
            }
        };

    pc.onconnectionstatechange =
        () => {
            if (
                pc.connectionState ===
                    "failed" ||
                pc.connectionState ===
                    "closed"
            ) {
                removePeer(
                    peerId
                );
            }

            updateCallMembers();
        };

    return pc;
}

function removePeer(peerId) {
    const pc =
        peerConnections[
            peerId
        ];

    if (pc) {
        try {
            pc.close();
        } catch {}
    }

    delete peerConnections[
        peerId
    ];

    const audio =
        document.getElementById(
            "audio-" +
            peerId
        );

    if (audio) {
        audio.remove();
    }
}

/* =====================================================
   PRIVATE CALL
===================================================== */

async function startPrivateCall(
    code
) {
    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "VedChat is not connected."
        );

        return;
    }

    try {
        localStream =
            await getMicrophone();

        const callId =
            cryptoRandomId();

        currentCall = {
            callId,
            type: "private",
            target: code,
            groupId: null,
            startedAt:
                new Date().toISOString()
        };

        await showCallUI(
            "Calling..."
        );

        const pc =
            createPeer(
                code,
                code
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

        addCallHistory({
            type: "outgoing",
            name:
                friendName(code),
            code,
            time:
                new Date().toISOString(),
            status: "Outgoing"
        });

    } catch (error) {
        console.error(error);

        alert(
            "Could not start the call. Check microphone permission."
        );

        cleanupCall();
    }
}

function receiveIncomingCall(
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

    render(`
        <div class="incoming-call">

            <div class="incoming-avatar">
                ${avatarHTML(
                    incomingCall.avatar || "",
                    incomingCall.sender ||
                    "User",
                    100
                )}
            </div>

            <div class="incoming-icon">
                📞
            </div>

            <h1>
                Incoming call
            </h1>

            <h2>
                ${escapeHTML(
                    incomingCall.sender ||
                    "User"
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
    stopRingtone();

    const call =
        incomingCall;

    try {
        localStream =
            await getMicrophone();

        currentCall = {
            callId:
                call.callId,
            type:
                call.groupId
                    ? "group"
                    : "private",
            target:
                call.from,
            groupId:
                call.groupId ||
                null,
            startedAt:
                new Date().toISOString()
        };

        const peerId =
            call.from;

        const pc =
            createPeer(
                peerId,
                peerId,
                call.groupId ||
                null
            );

        await pc.setRemoteDescription(
            new RTCSessionDescription(
                call.offer
            )
        );

        await addPendingCandidates(
            peerId
        );

        const answer =
            await pc.createAnswer();

        await pc.setLocalDescription(
            answer
        );

        send({
            type: "call-answer",
            to:
                call.from,
            target:
                call.from,
            groupId:
                call.groupId,
            callId:
                call.callId,
            answer
        });

        incomingCall =
            null;

        await showCallUI(
            "Connected"
        );

    } catch (error) {
        console.error(error);

        alert(
            "Could not answer the call."
        );

        incomingCall =
            null;

        cleanupCall();
        showHome();
    }
}

function declineIncomingCall() {
    if (!incomingCall) return;
    stopRingtone();

    send({
        type: "call-decline",
        to:
            incomingCall.from,
        groupId:
            incomingCall.groupId,
        callId:
            incomingCall.callId
    });

    addCallHistory({
        type: "incoming",
        name:
            incomingCall.sender ||
            "User",
        code:
            incomingCall.from,
        time:
            new Date().toISOString(),
        status: "Declined"
    });

    incomingCall =
        null;

    showHome();
}

async function receiveCallOffer(
    message
) {
    /*
     * If this is a group offer and we're
     * already in the call, answer it.
     *
     * Otherwise show incoming-call screen.
     */

    if (
        message.groupId &&
        currentCall &&
        currentCall.groupId ===
            message.groupId
    ) {
        try {
            await answerOfferForGroup(
                message
            );
        } catch (error) {
            console.error(
                "Group offer error:",
                error
            );
        }

        return;
    }

    receiveIncomingCall(
        message
    );
}

async function answerOfferForGroup(
    message
) {
    const peerId =
        message.from;

    let pc =
        peerConnections[
            peerId
        ];

    if (!pc) {
        pc =
            createPeer(
                peerId,
                peerId,
                message.groupId
            );
    }

    await pc.setRemoteDescription(
        new RTCSessionDescription(
            message.offer
        )
    );

    await addPendingCandidates(
        peerId
    );

    const answer =
        await pc.createAnswer();

    await pc.setLocalDescription(
        answer
    );

    send({
        type: "call-answer",
        to:
            message.from,
        target:
            message.from,
        groupId:
            message.groupId,
        callId:
            message.callId,
        answer
    });

    updateCallMembers();
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

        await addPendingCandidates(
            message.from
        );

        updateCallMembers();

        const status =
            document.getElementById(
                "callStatus"
            );

        if (status) {
            status.textContent =
                "Connected";
        }

    } catch (error) {
        console.error(
            "Call answer error:",
            error
        );
    }
}

async function handleIceCandidate(
    message
) {
    const peerId =
        message.from;

    const pc =
        peerConnections[
            peerId
        ];

    if (
        !pc ||
        !pc.remoteDescription
    ) {
        if (
            !pendingCandidates[
                peerId
            ]
        ) {
            pendingCandidates[
                peerId
            ] = [];
        }

        pendingCandidates[
            peerId
        ].push(
            message.candidate
        );

        return;
    }

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

async function addPendingCandidates(
    peerId
) {
    const pc =
        peerConnections[
            peerId
        ];

    const candidates =
        pendingCandidates[
            peerId
        ] || [];

    for (
        const candidate of
            candidates
    ) {
        try {
            await pc.addIceCandidate(
                candidate
            );
        } catch {}
    }

    delete pendingCandidates[
        peerId
    ];
}

/* =====================================================
   GROUP CALL
===================================================== */

async function startGroupCall(
    groupId
) {
    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "VedChat is not connected."
        );

        return;
    }

    const group =
        groups.find(
            g =>
                g.id ===
                groupId
        );

    if (!group) {
        alert(
            "Group not found."
        );

        return;
    }

    try {
        localStream =
            await getMicrophone();

        const callId =
            cryptoRandomId();

        currentCall = {
            callId,
            type: "group",
            groupId,
            startedAt:
                new Date().toISOString()
        };

        await showCallUI(
            "Starting group call..."
        );

        /*
         * The current server routes call-offer signaling.
         * Each member receives an offer and can answer it,
         * so a separate call-invite packet is not required.
         */

        for (
            const member of
                group.members
        ) {
            if (
                member ===
                myCode
            ) {
                continue;
            }

            const online =
                friends.some(
                    friend =>
                        friend.code ===
                            member &&
                        friend.online
                );

            /*
             * The member might not be in
             * our friends array, so we still
             * attempt signaling.
             */

            if (
                online === false &&
                friends.some(
                    friend =>
                        friend.code ===
                        member
                )
            ) {
                continue;
            }

            try {
                await createGroupOffer(
                    member,
                    groupId,
                    callId
                );
            } catch (error) {
                console.error(
                    "Group offer error:",
                    error
                );
            }
        }

        addCallHistory({
            type: "outgoing",
            name:
                group.name,
            groupId,
            time:
                new Date().toISOString(),
            status: "Group call"
        });

    } catch (error) {
        console.error(error);

        alert(
            "Could not start group call."
        );

        cleanupCall();
    }
}

async function createGroupOffer(
    peerId,
    groupId,
    callId
) {
    const pc =
        createPeer(
            peerId,
            peerId,
            groupId
        );

    const offer =
        await pc.createOffer();

    await pc.setLocalDescription(
        offer
    );

    send({
        type: "call-offer",
        to: peerId,
        target: peerId,
        groupId,
        callId,
        offer
    });
}

/* =====================================================
   CALL UI
===================================================== */

async function showCallUI(
    status
) {
    currentPage =
        "call";

    render(`
        <div class="call-screen">

            <div class="call-top">

                <div class="call-logo">
                    📞
                </div>

                <div>
                    <h1>
                        VedChat Call
                    </h1>

                    <p id="callStatus">
                        ${escapeHTML(status)}
                    </p>
                </div>

            </div>

            <div
                id="callMembers"
                class="call-members"
            ></div>

            <div class="call-tip">
                🎙️ Microphone connected
            </div>

            <button
                class="danger-btn end-call"
                onclick="endCall()"
            >
                📵 End Call
            </button>

        </div>
    `);

    updateCallMembers();
}

function updateCallMembers() {
    const box =
        document.getElementById(
            "callMembers"
        );

    if (!box) return;

    const ids =
        Object.keys(
            peerConnections
        );

    if (!ids.length) {
        box.innerHTML = `
            <div class="call-empty">
                Waiting for other person...
            </div>
        `;

        return;
    }

    box.innerHTML =
        ids.map(
            id => {
                const friend =
                    friends.find(
                        f =>
                            f.code === id
                    );

                return `
                    <div class="call-member">
                        ${avatarHTML(
                            friend?.avatar ||
                            "",
                            friend?.name ||
                            "User",
                            64
                        )}

                        <strong>
                            ${escapeHTML(
                                friend?.name ||
                                "User"
                            )}
                        </strong>

                        <small>
                            🎙️ Connected
                        </small>
                    </div>
                `;
            }
        ).join("");
}

function endCall() {
    if (currentCall) {
        send({
            type: "call-end",
            to:
                currentCall.target,
            groupId:
                currentCall.groupId,
            callId:
                currentCall.callId
        });

        addCallHistory({
            type: "call",
            name:
                currentCall.groupId
                    ? groupName(
                        currentCall.groupId
                    )
                    : friendName(
                        currentCall.target
                    ),
            code:
                currentCall.target,
            groupId:
                currentCall.groupId,
            time:
                new Date().toISOString(),
            status: "Ended"
        });
    }

    cleanupCall();

    showHome();
}

function handleRemoteCallEnd(
    message
) {
    if (
        currentCall &&
        message.callId &&
        currentCall.callId !==
            message.callId
    ) {
        return;
    }

    cleanupCall();

    alert(
        "The call ended."
    );

    showHome();
}

function handleRemoteCallLeave(
    message
) {
    if (message.from) {
        removePeer(
            message.from
        );
    }

    updateCallMembers();
}

function handleCallDecline(
    message
) {
    addCallHistory({
        type: "call",
        name:
            message.sender ||
            friendName(
                message.from
            ),
        code:
            message.from,
        time:
            new Date().toISOString(),
        status: "Declined"
    });

    cleanupCall();

    showHome();
}

/* =====================================================
   CLEANUP
===================================================== */

function cleanupCall() {
    stopRingtone();
    Object.keys(
        peerConnections
    ).forEach(
        peerId =>
            removePeer(
                peerId
            )
    );

    peerConnections = {};

    pendingCandidates = {};

    if (localStream) {
        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );
    }

    localStream = null;

    currentCall = null;

    document
        .querySelectorAll(
            "audio[id^='audio-']"
        )
        .forEach(
            audio =>
                audio.remove()
        );
}

/* =====================================================
   CALL HISTORY
===================================================== */

function addCallHistory(call) {
    callHistory.unshift(call);

    if (callHistory.length > 200) {
        callHistory =
            callHistory.slice(
                0,
                200
            );
    }

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

            <div
                id="callHistoryList"
                class="list"
            ></div>

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
                <div class="empty-icon">
                    📞
                </div>

                <h3>
                    No calls yet
                </h3>

                <p>
                    Your calls will appear here.
                </p>
            </div>
        `;

        return;
    }

    callHistory
        .slice(0, 50)
        .forEach(
            call => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    "friend-item";

                const incoming =
                    call.type ===
                    "incoming";

                item.innerHTML = `
                    <div class="history-icon">
                        ${
                            incoming
                                ? "📲"
                                : "📞"
                        }
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

                    <small class="chat-time">
                        ${formatTime(
                            call.time
                        )}
                    </small>
                `;

                list.appendChild(
                    item
                );
            }
        );
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

            <section class="profile-card">

                <div
                    class="profile-avatar"
                    onclick="chooseAvatar()"
                >
                    ${avatarHTML(
                        myAvatar,
                        myName,
                        120
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
                        myCode ||
                        "Creating..."
                    )}
                </div>

                <button
                    class="primary-btn"
                    onclick="chooseAvatar()"
                >
                    📷 Change Picture
                </button>

                <button
                    class="secondary-btn"
                    onclick="editProfile()"
                >
                    ✏️ Edit Name
                </button>

            </section>

            <div class="stat-row">

                <div class="stat">
                    <strong>
                        ${friends.length}
                    </strong>

                    <span>
                        Friends
                    </span>
                </div>

                <div class="stat">
                    <strong>
                        ${groups.length}
                    </strong>

                    <span>
                        Groups
                    </span>
                </div>

                <div class="stat">
                    <strong>
                        ${callHistory.length}
                    </strong>

                    <span>
                        Calls
                    </span>
                </div>

            </div>

            <section class="card">

                <h2>
                    ⚡ Account
                </h2>

                <p>
                    Your connection code lets
                    friends find you.
                </p>

                <button
                    class="secondary-btn"
                    onclick="copyCode()"
                >
                    📋 Copy My Code
                </button>

            </section>

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
                <span>🏠</span>
                <small>Home</small>
            </button>

            <button
                class="${
                    active === "chats"
                        ? "active"
                        : ""
                }"
                onclick="showChats()"
            >
                <span>💬</span>
                <small>Chats</small>
            </button>

            <button
                class="${
                    active === "friends"
                        ? "active"
                        : ""
                }"
                onclick="showFriends()"
            >
                <span>🧑‍🤝‍🧑</span>
                <small>Friends</small>
            </button>

            <button
                class="${
                    active === "groups"
                        ? "active"
                        : ""
                }"
                onclick="showGroups()"
            >
                <span>👥</span>
                <small>Groups</small>
            </button>

            <button
                class="${
                    active === "profile"
                        ? "active"
                        : ""
                }"
                onclick="showProfile()"
            >
                <span>👤</span>
                <small>Me</small>
            </button>

        </nav>
    `;
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
   STATUS
===================================================== */

function updateStatus(
    rerender = false
) {
    const indicator =
        document.getElementById(
            "connectionIndicator"
        );

    if (indicator) {
        indicator.textContent =
            connectionState;
    }

    if (
        rerender &&
        currentPage ===
            "home"
    ) {
        showHome();
    }
}

/* =====================================================
   HELPERS
===================================================== */

function formatTime(time) {
    if (!time) return "";

    const date =
        new Date(time);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
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

function friendName(code) {
    return (
        friends.find(
            f =>
                f.code === code
        )?.name ||
        "User"
    );
}

function groupName(id) {
    return (
        groups.find(
            g =>
                g.id === id
        )?.name ||
        "Group"
    );
}

function cryptoRandomId() {
    if (
        window.crypto &&
        crypto.randomUUID
    ) {
        return crypto.randomUUID();
    }

    return (
        Date.now() +
        "-" +
        Math.random()
            .toString(36)
            .slice(2)
    );
}

/* =====================================================
   STARTUP
===================================================== */

createAccountIfNeeded();
ensureNotificationPermission();

showHome();

connectServer();