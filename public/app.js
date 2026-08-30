/* =====================================================
   VEDCHAT V3
   Messaging + Friends + Groups + Calls + QR
   Notifications + Ringtones + Mobile UI
===================================================== */

let ws = null;
let connectionState = "offline";

let myCode = localStorage.getItem("vedchat_code") || "";
let myName = localStorage.getItem("vedchat_name") || "";
let myAvatar = localStorage.getItem("vedchat_avatar") || "";

let currentPage = "home";
let currentFriend = null;
let currentGroup = null;

let friends = [];
let groups = [];

let privateMessages = JSON.parse(
    localStorage.getItem("vedchat_private_messages") || "{}"
);

let groupMessages = JSON.parse(
    localStorage.getItem("vedchat_group_messages") || "{}"
);

let callHistory = JSON.parse(
    localStorage.getItem("vedchat_call_history") || "[]"
);

let peerConnections = {};
let localStream = null;
let incomingCall = null;

let reconnectTimer = null;
let ringtoneTimer = null;

let audioContext = null;

/* =====================================================
   HELPERS
===================================================== */

function escapeHTML(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
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

function avatarHTML(avatar, name, size = 50) {
    if (avatar) {
        return `
            <img
                src="${escapeHTML(avatar)}"
                class="avatar-img"
                style="width:${size}px;height:${size}px;"
            >
        `;
    }

    return `
        <div
            class="avatar"
            style="width:${size}px;height:${size}px;"
        >
            ${escapeHTML(
                String(name || "U").charAt(0).toUpperCase()
            )}
        </div>
    `;
}

function websocketURL() {
    return location.protocol === "https:"
        ? "wss://" + location.host
        : "ws://" + location.host;
}

/* =====================================================
   AUDIO SYSTEM
===================================================== */

function unlockAudio() {
    try {
        if (!audioContext) {
            const AudioContext =
                window.AudioContext ||
                window.webkitAudioContext;

            if (!AudioContext) return;

            audioContext = new AudioContext();
        }

        if (audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
    } catch (error) {
        console.log("Audio unavailable:", error);
    }
}

/*
   Plays a short clean notification tone.
*/
function playTone(frequency, duration = 0.18, volume = 0.16) {
    try {
        unlockAudio();

        if (!audioContext) return;

        const oscillator =
            audioContext.createOscillator();

        const gain =
            audioContext.createGain();

        const now =
            audioContext.currentTime;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(
            frequency,
            now
        );

        gain.gain.setValueAtTime(
            0.0001,
            now
        );

        gain.gain.exponentialRampToValueAtTime(
            volume,
            now + 0.025
        );

        gain.gain.exponentialRampToValueAtTime(
            0.0001,
            now + duration
        );

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.start(now);

        oscillator.stop(
            now + duration + 0.03
        );
    } catch (error) {
        console.log("Tone error:", error);
    }
}

/*
   Message notification:
   two pleasant tones.
*/
function playMessageNotification() {
    unlockAudio();

    playTone(880, 0.12, 0.12);

    setTimeout(() => {
        playTone(1175, 0.18, 0.14);
    }, 130);
}

/*
   Incoming call ringtone.

   This is generated locally, so you don't need
   a ringtone MP3 file.
*/
function startIncomingRingtone() {
    stopIncomingRingtone();

    unlockAudio();

    function ring() {
        playTone(740, 0.22, 0.18);

        setTimeout(() => {
            playTone(587, 0.22, 0.18);
        }, 250);

        setTimeout(() => {
            playTone(740, 0.22, 0.18);
        }, 500);
    }

    ring();

    ringtoneTimer = setInterval(
        ring,
        1500
    );
}

function stopIncomingRingtone() {
    if (ringtoneTimer) {
        clearInterval(ringtoneTimer);
        ringtoneTimer = null;
    }
}

/* =====================================================
   BROWSER NOTIFICATIONS
===================================================== */

async function requestNotifications() {
    if (!("Notification" in window)) {
        return false;
    }

    try {
        if (Notification.permission === "default") {
            const permission =
                await Notification.requestPermission();

            return permission === "granted";
        }

        return Notification.permission === "granted";
    } catch {
        return false;
    }
}

function showNotification(title, body) {
    if (!("Notification" in window)) {
        return;
    }

    if (Notification.permission !== "granted") {
        return;
    }

    try {
        const notification =
            new Notification(title, {
                body: body,
                icon: "/icon.png",
                tag: "vedchat-" + Date.now(),
                requireInteraction: false
            });

        notification.onclick = () => {
            window.focus();

            if (incomingCall) {
                showIncomingCall();
            }
        };
    } catch (error) {
        console.log(
            "Notification error:",
            error
        );
    }
}

/*
   Combined message alert.
*/
function notifyNewMessage(title, text) {
    playMessageNotification();

    showNotification(
        title || "New VedChat message",
        text || "You received a new message."
    );
}

/*
   Combined incoming-call alert.
*/
function notifyIncomingCall(caller) {
    startIncomingRingtone();

    showNotification(
        "📞 Incoming VedChat call",
        (caller || "Someone") +
            " is calling you"
    );
}

/* =====================================================
   CONNECT
===================================================== */

function connectServer() {
    if (
        ws &&
        (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    connectionState = "connecting";
    updateStatus();

    try {
        ws = new WebSocket(
            websocketURL()
        );
    } catch (error) {
        console.error(error);
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        connectionState = "connected";

        updateStatus();

        if (myName) {
            sendRaw({
                type: "register",
                code: myCode,
                name: myName,
                avatar: myAvatar
            });
        }

        /*
           Request notification permission after
           the connection has been established.
        */
        requestNotifications();
    };

    ws.onclose = () => {
        connectionState = "offline";

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
                JSON.parse(event.data);

            handleMessage(message);
        } catch (error) {
            console.error(
                "Message error:",
                error
            );
        }
    };
}

function scheduleReconnect() {
    if (reconnectTimer) {
        return;
    }

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectServer();
    }, 3000);
}

function sendRaw(data) {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        try {
            ws.send(
                JSON.stringify(data)
            );

            return true;
        } catch {}
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
            myCode = message.code;
            myName = message.name;
            myAvatar = message.avatar || "";

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

            if (currentPage === "home") {
                showHome();
            }

            break;

        case "profile-updated":
            myName = message.name;
            myAvatar = message.avatar || "";

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

        case "friend-profile-updated":
            friends = friends.map(friend => {
                if (
                    friend.code ===
                    message.code
                ) {
                    return {
                        ...friend,
                        name: message.name,
                        avatar:
                            message.avatar || ""
                    };
                }

                return friend;
            });

            if (currentPage === "friends") {
                showFriends();
            }

            break;

        case "friends-list":
            friends = message.friends || [];

            if (currentPage === "friends") {
                showFriends();
            }

            break;

        case "friends-updated":
            getFriends();
            break;

        case "friend-added":
            getFriends();

            playMessageNotification();

            break;

        case "presence":
            friends = friends.map(friend => {
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

            if (currentPage === "friends") {
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
            groups = message.groups || [];

            if (currentPage === "groups") {
                showGroups();
            }

            break;

        case "group-created":
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
            getGroups();
            break;

        /* ================= CALLS ================= */

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
            stopIncomingRingtone();

            finishCallHistory(
                "Declined"
            );

            if (
                currentPage ===
                "call"
            ) {
                showHome();
            }

            break;

        case "call-end":
            stopIncomingRingtone();

            endAllCallConnections();

            if (
                currentPage ===
                "call"
            ) {
                showHome();
            }

            break;

        case "error":
            alert(
                message.message
            );

            break;

        default:
            console.log(
                "Ignored server message:",
                message.type
            );
    }
}

/* =====================================================
   ACCOUNT
===================================================== */

function createAccountIfNeeded() {
    if (myName) {
        return;
    }

    const name =
        prompt(
            "Choose your VedChat display name:"
        );

    myName =
        name &&
        name.trim()
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
    currentPage = "home";

    render(`
        <header class="topbar">
            <div class="brand">
                <div class="brand-icon">V</div>

                <div>
                    <h1>VedChat</h1>
                    <small>
                        Fast private messaging
                    </small>
                </div>
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
                <div class="hero-user">
                    ${avatarHTML(
                        myAvatar,
                        myName,
                        66
                    )}

                    <div>
                        <h2>
                            Hi,
                            ${escapeHTML(
                                myName
                            )} 👋
                        </h2>

                        <div class="status-line">
                            <span class="
                                status-dot
                                ${
                                    connectionState ===
                                    "connected"
                                        ? "online-dot"
                                        : ""
                                }
                            "></span>

                            ${
                                connectionState ===
                                "connected"
                                    ? "Connected"
                                    : "Connecting..."
                            }
                        </div>
                    </div>
                </div>

                <div class="code-box">
                    <span>Your VedChat code</span>

                    <strong>
                        ${escapeHTML(
                            myCode ||
                            "Creating..."
                        )}
                    </strong>

                    <button
                        class="copy-btn"
                        onclick="copyCode()"
                    >
                        📋 Copy
                    </button>
                </div>
            </section>

            <h3 class="section-heading">
                Quick actions
            </h3>

            <div class="action-grid">
                <button
                    class="action-card"
                    onclick="showChats()"
                >
                    <span>💬</span>
                    <strong>Chats</strong>
                    <small>Messages</small>
                </button>

                <button
                    class="action-card"
                    onclick="showFriends()"
                >
                    <span>🧑‍🤝‍🧑</span>
                    <strong>Friends</strong>
                    <small>Your contacts</small>
                </button>

                <button
                    class="action-card"
                    onclick="showGroups()"
                >
                    <span>👥</span>
                    <strong>Groups</strong>
                    <small>Group chats</small>
                </button>

                <button
                    class="action-card"
                    onclick="showConnect()"
                >
                    <span>🔗</span>
                    <strong>Connect</strong>
                    <small>Code or QR</small>
                </button>
            </div>

            <button
                class="wide-button"
                onclick="showCallHistory()"
            >
                <span>📞</span>

                <div>
                    <strong>
                        Call History
                    </strong>

                    <small>
                        ${callHistory.length}
                        recorded calls
                    </small>
                </div>

                <b>›</b>
            </button>
        </main>

        ${bottomNav("home")}
    `);
}

function copyCode() {
    if (!myCode) return;

    if (navigator.clipboard) {
        navigator.clipboard
            .writeText(myCode)
            .then(() =>
                alert(
                    "Code copied!"
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
   CONNECT / QR
===================================================== */

function showConnect() {
    currentPage = "connect";

    render(`
        <header class="topbar">
            <div>
                <h1>Connect</h1>
                <small>
                    Add a new friend
                </small>
            </div>
        </header>

        <main>
            <section class="card">
                <div class="card-title">
                    <span>🔢</span>

                    <div>
                        <h2>
                            Connection code
                        </h2>

                        <small>
                            Enter your friend's code
                        </small>
                    </div>
                </div>

                <input
                    id="friendCode"
                    class="large-input"
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

            <section class="card qr-card">
                <div class="card-title">
                    <span>📷</span>

                    <div>
                        <h2>
                            QR connection
                        </h2>

                        <small>
                            Scan your friend's QR
                        </small>
                    </div>
                </div>

                <button
                    class="primary-btn"
                    onclick="startQRScanner()"
                >
                    📷 Scan QR Code
                </button>

                <button
                    class="secondary-btn"
                    onclick="stopQRScanner()"
                >
                    ✕ Stop Scanner
                </button>

                <div
                    id="scanner"
                    class="scanner"
                ></div>
            </section>

            <section class="card center-card">
                <div class="card-title">
                    <span>🔳</span>

                    <div>
                        <h2>
                            Your QR code
                        </h2>

                        <small>
                            Let friends scan this
                        </small>
                    </div>
                </div>

                <div
                    id="myQR"
                    class="qr-box"
                ></div>

                <strong class="qr-code-text">
                    ${escapeHTML(
                        myCode ||
                        "Creating..."
                    )}
                </strong>
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

function showFoundUser(user, online) {
    const app =
        document.getElementById(
            "app"
        );

    if (!app) return;

    const main =
        app.querySelector(
            "main"
        );

    if (!main) return;

    document
        .getElementById("foundUser")
        ?.remove();

    const card =
        document.createElement(
            "section"
        );

    card.id = "foundUser";
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
                ${
                    online
                        ? "🟢 Online"
                        : "⚪ Offline"
                }
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

    main.appendChild(card);
}

function addFriend(code) {
    send({
        type: "add-friend",
        code
    });
}

function generateMyQR() {
    const box =
        document.getElementById(
            "myQR"
        );

    if (!box || !myCode) {
        return;
    }

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
                height: 210,
                correctLevel:
                    QRCode.CorrectLevel.M
            }
        );
    } else {
        box.innerHTML = `
            <div class="qr-fallback">
                ${escapeHTML(
                    myCode
                )}
            </div>
        `;
    }
}

let qrStream = null;
let qrScanning = false;

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
                Camera access is not available
                in this browser.
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
                Use the connection-code box above.
            </div>
        `;

        return;
    }

    stopQRScanner();

    try {
        qrStream =
            await navigator.mediaDevices
                .getUserMedia({
                    video: {
                        facingMode:
                            "environment"
                    },
                    audio: false
                });

        const video =
            document.createElement(
                "video"
            );

        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.className =
            "scanner-video";

        video.srcObject =
            qrStream;

        scanner.innerHTML = "";

        scanner.appendChild(
            video
        );

        const detector =
            new BarcodeDetector({
                formats: [
                    "qr_code"
                ]
            });

        qrScanning = true;

        const scan =
            async () => {
                if (!qrScanning) {
                    return;
                }

                if (
                    video.readyState < 2
                ) {
                    requestAnimationFrame(
                        scan
                    );

                    return;
                }

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
                            }

                            lookupFriend();
                        } else {
                            alert(
                                "That QR code is not a VedChat connection code."
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

function stopQRScanner() {
    qrScanning = false;

    if (qrStream) {
        qrStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        qrStream = null;
    }

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

function showFriends() {
    currentPage = "friends";

    render(`
        <header class="topbar">
            <div>
                <h1>Friends</h1>

                <small>
                    ${friends.length}
                    friend${friends.length === 1 ? "" : "s"}
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
                    their code or QR code.
                </p>
            </div>
        `;

        return;
    }

    friends.forEach(friend => {
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
                54
            )}

            <div
                class="friend-info"
                onclick="openPrivateChat(
                    '${escapeHTML(
                        friend.code
                    )}'
                )"
            >
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
                class="round-action"
                onclick="openPrivateChat(
                    '${escapeHTML(
                        friend.code
                    )}'
                )"
            >
                💬
            </button>

            <button
                class="round-action"
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
    });
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

function receivePrivateMessage(message) {
    const other =
        message.from === myCode
            ? message.to
            : message.from;

    if (!other) return;

    const messages =
        getPrivateMessages(
            other
        );

    messages.push(message);

    saveLocal();

    const visible =
        currentPage ===
            "private-chat" &&
        currentFriend ===
            other;

    if (!visible) {
        notifyNewMessage(
            message.sender ||
                "New message",
            message.text
        );
    }

    if (visible) {
        displayPrivateMessages();
    }
}

function openPrivateChat(code) {
    currentFriend = code;
    currentPage = "private-chat";

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
                46
            )}

            <div class="chat-person">
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
                <input
                    id="privateMessageInput"
                    placeholder="Write a message..."
                    autocomplete="off"
                >

                <button
                    class="send-btn"
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
            if (event.key === "Enter") {
                event.preventDefault();
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
    input.focus();
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

    messages.forEach(message => {
        const mine =
            message.from === myCode;

        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            mine
                ? "message mine"
                : "message";

        bubble.innerHTML = `
            <div class="message-body">
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
    });

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   CHATS
===================================================== */

function showChats() {
    currentPage = "chats";

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

            <h3 class="section-heading">
                Recent Chats
            </h3>

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
                    Add a friend to start
                    chatting.
                </p>
            </div>
        `;

        return;
    }

    codes
        .sort((a, b) => {
            const ma =
                privateMessages[a] || [];

            const mb =
                privateMessages[b] || [];

            return (
                new Date(
                    mb[
                        mb.length - 1
                    ]?.time || 0
                ) -
                new Date(
                    ma[
                        ma.length - 1
                    ]?.time || 0
                )
            );
        })
        .forEach(code => {
            const friend =
                friends.find(
                    item =>
                        item.code ===
                        code
                );

            const messages =
                privateMessages[
                    code
                ] || [];

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
                    54
                )}

                <div class="friend-info">
                    <strong>
                        ${escapeHTML(
                            friend?.name ||
                            last.sender ||
                            "User"
                        )}
                    </strong>

                    <small class="chat-preview">
                        ${escapeHTML(
                            last.text
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
        });
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

function showGroups() {
    currentPage = "groups";

    render(`
        <header class="topbar">
            <div>
                <h1>Groups</h1>

                <small>
                    ${groups.length}
                    group${groups.length === 1 ? "" : "s"}
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
                    Create your first
                    group conversation.
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
                    ${
                        group.members?.length ||
                        0
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

    currentGroup = groupId;
    currentPage = "group-chat";

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

            <div class="chat-person">
                <strong>
                    ${escapeHTML(
                        group.name
                    )}
                </strong>

                <small>
                    ${
                        group.members?.length ||
                        0
                    }
                    members
                </small>
            </div>

            <button
                class="icon-btn"
                onclick="startGroupCall(
                    '${escapeHTML(
                        groupId
                    )}'
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
                    autocomplete="off"
                >

                <button
                    class="send-btn"
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
            if (event.key === "Enter") {
                event.preventDefault();
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
    input.focus();
}

function receiveGroupMessage(message) {
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

    const visible =
        currentPage ===
            "group-chat" &&
        currentGroup ===
            message.groupId;

    if (!visible) {
        notifyNewMessage(
            message.sender ||
                "Group message",
            message.text
        );
    }

    if (visible) {
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

    messages.forEach(message => {
        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            message.from === myCode
                ? "message mine"
                : "message";

        bubble.innerHTML = `
            ${
                message.from !== myCode
                    ? `
                        <small class="sender-name">
                            ${escapeHTML(
                                message.sender ||
                                ""
                            )}
                        </small>
                    `
                    : ""
            }

            <div class="message-body">
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
    });

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   CALLING
===================================================== */

async function getMicrophone() {
    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        throw new Error(
            "Microphone unavailable"
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
                    target,
                    groupId,
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

                audio.playsInline =
                    true;

                document.body.appendChild(
                    audio
                );
            }

            audio.srcObject =
                event.streams[0];

            audio.play?.().catch(
                () => {}
            );
        };

    pc.onconnectionstatechange =
        () => {
            console.log(
                "Peer state:",
                pc.connectionState
            );

            if (
                pc.connectionState ===
                    "connected"
            ) {
                updateCallStatus(
                    "Connected"
                );
            }
        };

    return pc;
}

async function startPrivateCall(code) {
    try {
        unlockAudio();

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

        const friend =
            friends.find(
                f =>
                    f.code ===
                    code
            );

        callHistory.unshift({
            type: "outgoing",
            name:
                friend?.name ||
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
            "Could not start the call. Please allow microphone permission."
        );

        cleanupCall();
    }
}

async function receiveIncomingCall(message) {
    if (incomingCall) {
        return;
    }

    incomingCall = message;

    /*
       Start ringtone immediately.
    */
    unlockAudio();

    notifyIncomingCall(
        message.sender ||
            "Someone"
    );

    showIncomingCall();
}

function showIncomingCall() {
    if (!incomingCall) {
        return;
    }

    const caller =
        incomingCall.sender ||
        "User";

    render(`
        <div class="incoming-call-screen">

            <div class="incoming-ring">
                📞
            </div>

            <div class="call-pulse"></div>

            <p class="call-label">
                INCOMING CALL
            </p>

            <h1>
                ${escapeHTML(
                    caller
                )}
            </h1>

            <p>
                is calling you...
            </p>

            <div class="call-actions">

                <button
                    class="answer-btn"
                    onclick="answerIncomingCall()"
                >
                    📞
                    <span>
                        Answer
                    </span>
                </button>

                <button
                    class="decline-call-btn"
                    onclick="declineIncomingCall()"
                >
                    ✕
                    <span>
                        Decline
                    </span>
                </button>

            </div>
        </div>
    `);
}

async function answerIncomingCall() {
    if (!incomingCall) {
        return;
    }

    try {
        unlockAudio();

        stopIncomingRingtone();

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
            type: "call-answer",
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

        const callerName =
            incomingCall.sender ||
            "User";

        incomingCall = null;

        await showCallUI(
            "Connected"
        );

        updateCallStatus(
            "Connected with " +
            callerName
        );
    } catch (error) {
        console.error(error);

        alert(
            "Could not answer the call."
        );

        stopIncomingRingtone();

        cleanupCall();
    }
}

function declineIncomingCall() {
    if (!incomingCall) {
        return;
    }

    stopIncomingRingtone();

    send({
        type: "call-decline",
        to:
            incomingCall.from,
        groupId:
            incomingCall.groupId,
        callId:
            incomingCall.callId
    });

    incomingCall = null;

    showHome();
}

async function handleCallAnswer(message) {
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

        updateCallStatus(
            "Connected"
        );
    } catch (error) {
        console.error(error);
    }
}

async function handleIceCandidate(message) {
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

async function startGroupCall(groupId) {
    try {
        unlockAudio();

        localStream =
            await getMicrophone();

        const group =
            groups.find(
                g =>
                    g.id ===
                    groupId
            );

        if (!group) {
            return;
        }

        await showCallUI(
            "Starting group call..."
        );

        const callId =
            Date.now().toString();

        send({
            type: "call",
            action: "offer",
            groupId,
            callId
        });

        for (
            const member of
                group.members || []
        ) {
            if (
                member ===
                myCode
            ) {
                continue;
            }

            const online =
                friends.some(
                    f =>
                        f.code ===
                            member &&
                        f.online
                );

            if (!online) {
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
                type: "call-offer",
                to: member,
                target: member,
                groupId,
                callId,
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

async function showCallUI(status) {
    currentPage = "call";

    render(`
        <div class="call-screen">

            <div class="call-top">
                <span>
                    VedChat
                </span>

                <span class="secure-label">
                    🔒 Private
                </span>
            </div>

            <div class="call-avatar">
                📞
            </div>

            <h1>
                VedChat Call
            </h1>

            <p
                id="callStatus"
                class="call-status"
            >
                ${escapeHTML(
                    status
                )}
            </p>

            <div
                id="callMembers"
                class="call-members"
            >
                <div class="call-chip">
                    🎙️
                    <span>
                        Microphone active
                    </span>
                </div>
            </div>

            <button
                class="end-call-button"
                onclick="endCall()"
            >
                📵
                End Call
            </button>

        </div>
    `);
}

function updateCallStatus(status) {
    const element =
        document.getElementById(
            "callStatus"
        );

    if (element) {
        element.textContent =
            status;
    }
}

function endCall() {
    stopIncomingRingtone();

    if (currentFriend) {
        send({
            type: "call-end",
            to: currentFriend
        });
    } else {
        send({
            type: "call-end"
        });
    }

    endAllCallConnections();

    callHistory.unshift({
        type: "call",
        name:
            currentFriend
                ? (
                    friends.find(
                        f =>
                            f.code ===
                            currentFriend
                    )?.name ||
                    "User"
                )
                : "Group Call",
        time:
            new Date().toISOString(),
        status: "Ended"
    });

    saveLocal();

    currentFriend = null;
    currentGroup = null;

    showHome();
}

function endAllCallConnections() {
    Object.values(
        peerConnections
    ).forEach(pc => {
        try {
            pc.close();
        } catch {}
    });

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

    document
        .querySelectorAll(
            "audio[id^='audio-']"
        )
        .forEach(audio => {
            try {
                audio.pause();
            } catch {}

            audio.remove();
        });
}

function cleanupCall() {
    stopIncomingRingtone();

    incomingCall = null;

    endAllCallConnections();
}

/* =====================================================
   CALL HISTORY
===================================================== */

function finishCallHistory(status) {
    callHistory.unshift({
        type: "call",
        time:
            new Date().toISOString(),
        status
    });

    saveLocal();
}

function showCallHistory() {
    currentPage = "history";

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
                    Your call history will
                    appear here.
                </p>
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
                <div class="history-icon">
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
    currentPage = "profile";

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

                <button
                    class="secondary-btn"
                    onclick="requestNotifications()"
                >
                    🔔 Enable Notifications
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

    if (
        currentPage === "home" &&
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

/* =====================================================
   AUDIO UNLOCK
===================================================== */

/*
   Browsers require user interaction before
   allowing audio.

   The first tap/click unlocks our audio system.
*/
document.addEventListener(
    "click",
    () => {
        unlockAudio();
    },
    {
        once: true
    }
);

/*
   Also unlock on touch for phones.
*/
document.addEventListener(
    "touchstart",
    () => {
        unlockAudio();
    },
    {
        once: true,
        passive: true
    }
);

/* =====================================================
   STARTUP
===================================================== */

createAccountIfNeeded();

connectServer();

showHome();