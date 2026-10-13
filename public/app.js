/* =====================================================
   VEDCHAT V3 CLIENT
===================================================== */

"use strict";

/* =====================================================
   STATE
===================================================== */

let ws = null;

let connectionState = "offline";
let serverRegistered = false;
let friendRequests = loadJSON("vedchat_friend_requests", { incoming: [], outgoing: [] });
if (!friendRequests || typeof friendRequests !== "object") friendRequests = { incoming: [], outgoing: [] };
if (!Array.isArray(friendRequests.incoming)) friendRequests.incoming = [];
if (!Array.isArray(friendRequests.outgoing)) friendRequests.outgoing = [];

let myCode =
    localStorage.getItem("vedchat_code") || "";

let myName =
    localStorage.getItem("vedchat_name") || "";

let myAvatar =
    localStorage.getItem("vedchat_avatar") || "";

let currentPage = "home";

let currentFriend = null;
let currentGroup = null;
let vibes = [];
let currentVibeIndex = 0;

let friends = loadJSON("vedchat_friends", []);
let groups = loadJSON("vedchat_groups", []);

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

let blockedUsers = loadJSON("vedchat_blocked_users", []);
let typingTimers = {};
let friendTyping = {};

let reconnectTimer = null;

let heartbeatTimer = null;
let typingTimer = null;
let typingActive = false;
let typingFriend = null;
let voiceRecorder = null;
let voiceChunks = [];
let voiceStartedAt = 0;
// vibes is declared by the Vibe module above
let appLockLocked = false;

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
        "vedchat_friends",
        JSON.stringify(friends)
    );

    localStorage.setItem(
        "vedchat_groups",
        JSON.stringify(groups)
    );

    localStorage.setItem(
        "vedchat_blocked_users",
        JSON.stringify(blockedUsers)
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
    // Android WebView loads this app from file://, so location.host is empty.
    // Use the live VedChat Render server for online mode.
    return "wss://vedchat.onrender.com";
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

        const authToken = localStorage.getItem("vedchat_auth_token") || "";
        if (myCode || authToken) {
            createAccountIfNeeded();
            sendRaw({
                type: "register", code: myCode, name: myName, avatar: myAvatar, authToken,
                friends: friends.map(function(friend) { return { code: friend.code, name: friend.name || "", avatar: friend.avatar || "" }; })
            });
        } else {
            showAuthScreen();
        }

        serverRegistered = false;
        setTimeout(updateAppActivity, 150);
    };

    ws.onclose = () => {
        serverRegistered = false;
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

function sendAppState(active) {
    sendRaw({ type: "app-state", active: !!active });
}

function updateAppActivity() {
    if (!serverRegistered || connectionState !== "connected") return;
    sendAppState(document.visibilityState === "visible" && document.hasFocus());
}

document.addEventListener("visibilitychange", updateAppActivity);
window.addEventListener("focus", updateAppActivity);
window.addEventListener("blur", updateAppActivity);
let appLockTimer=null;
document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="hidden" && localStorage.getItem("vedchat_app_lock")){ clearTimeout(appLockTimer); appLockTimer=setTimeout(()=>{appLockLocked=true;},1500); } if(document.visibilityState==="visible" && appLockLocked && currentPage!=="auth") showAppLock(); });

function ensureUiLayer() {
    let layer = document.getElementById("vedUiLayer");
    if (!layer) {
        layer = document.createElement("div");
        layer.id = "vedUiLayer";
        document.body.appendChild(layer);
    }
    return layer;
}
function uiToast(message, kind) {
    const layer = ensureUiLayer();
    const item = document.createElement("div");
    item.className = "ved-toast " + (kind || "");
    item.textContent = String(message || "");
    layer.appendChild(item);
    setTimeout(function(){ item.classList.add("show"); }, 10);
    setTimeout(function(){ item.classList.remove("show"); setTimeout(function(){ item.remove(); }, 220); }, 2600);
}
function uiConfirm(title, message, onYes) {
    const layer = ensureUiLayer();
    const backdrop = document.createElement("div");
    backdrop.className = "ui-modal-backdrop";
    backdrop.innerHTML = '<div class="ui-modal"><div class="ui-modal-icon">💬</div><h3></h3><p></p><div class="ui-modal-actions"><button class="secondary-btn" data-no>Cancel</button><button class="primary-btn" data-yes>Continue</button></div></div>';
    backdrop.querySelector("h3").textContent = title || "VedChat";
    backdrop.querySelector("p").textContent = message || "";
    backdrop.querySelector("[data-no]").onclick = function(){ backdrop.remove(); };
    backdrop.querySelector("[data-yes]").onclick = function(){ backdrop.remove(); if (onYes) onYes(); };
    layer.appendChild(backdrop);
}
function uiPrompt(title, message, defaultValue, onYes) {
    const layer = ensureUiLayer();
    const backdrop = document.createElement("div");
    backdrop.className = "ui-modal-backdrop";
    backdrop.innerHTML = '<div class="ui-modal"><div class="ui-modal-icon">✏️</div><h3></h3><p></p><input class="ui-modal-input" type="text"><div class="ui-modal-actions"><button class="secondary-btn" data-no>Cancel</button><button class="primary-btn" data-yes>Continue</button></div></div>';
    backdrop.querySelector("h3").textContent = title || "VedChat";
    backdrop.querySelector("p").textContent = message || "";
    const input = backdrop.querySelector(".ui-modal-input");
    input.value = defaultValue || "";
    backdrop.querySelector("[data-no]").onclick = function(){ backdrop.remove(); };
    backdrop.querySelector("[data-yes]").onclick = function(){ const value=input.value; backdrop.remove(); if(onYes) onYes(value); };
    layer.appendChild(backdrop);
    setTimeout(function(){ input.focus(); input.select(); }, 80);
}
window.alert = function(message){ uiToast(message, "error"); };

function send(data) {
    if (!sendRaw(data)) {
        if (connectionState === "offline") uiToast("Connecting to VedChat…", "warn");
        return false;
    }
    return true;
}

/* =====================================================
   RINGTONE + NOTIFICATIONS
===================================================== */

let ringtoneTimer = null;
let audioContext = null;

function ensureNotificationPermission() {
    if (window.AndroidBluetooth && AndroidBluetooth.requestNotificationPermission) {
        try { AndroidBluetooth.requestNotificationPermission(); } catch {}
        return;
    }
    if ("Notification" in window && Notification.permission === "default") {
        try { Notification.requestPermission(); } catch {}
    }
}

function getSound(kind = "message") {
    const id = kind === "call" ? "ringtoneAudio" : "notificationAudio";
    return document.getElementById(id);
}

function unlockSounds() {
    try {
        const sounds = [
            getSound("message"),
            getSound("call")
        ];
        sounds.forEach(audio => {
            if (!audio) return;
            audio.muted = true;
            const p = audio.play();
            if (p && p.catch) p.catch(() => {});
            audio.pause();
            audio.currentTime = 0;
            audio.muted = false;
        });
    } catch {}
}

function playNotificationSound(kind = "message") {
    try {
        if (localStorage.getItem("vedchat_sounds") === "false") return;
        const audio = getSound(kind);
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
        const p = audio.play();
        if (p && p.catch) p.catch(() => {});
    } catch (e) {
        console.warn("Sound unavailable", e);
    }
}

function startRingtone() {
    stopRingtone();
    if (localStorage.getItem("vedchat_sounds") === "false") return;
    const audio = getSound("call");
    if (!audio) return;
    audio.loop = true;
    try {
        audio.currentTime = 0;
        const p = audio.play();
        if (p && p.catch) p.catch(() => {
            // Browsers can block audio until the user has interacted with the page.
        });
    } catch {}
}

function stopRingtone() {
    const audio = getSound("call");
    if (audio) {
        try {
            audio.pause();
            audio.currentTime = 0;
        } catch {}
    }
}

function showNotification(title, body, kind = "message") {
    playNotificationSound(kind);
    if (document.visibilityState === "visible") return;

    // Android app: use a native notification so file:// WebView does not
    if (window.AndroidBluetooth && AndroidBluetooth.showNotification) {
        try {
            AndroidBluetooth.showNotification(
                String(title || "VedChat"),
                String(body || "New VedChat notification"),
                String(kind || "message")
            );
            return;
        } catch {}
    }

    // Browser fallback.
    if ("Notification" in window && Notification.permission === "granted") {
        try { new Notification(title, { body, tag: "vedchat-" + kind }); } catch {}
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

        case "auth-success":
            localStorage.setItem("vedchat_auth_token", message.authToken || "");
            localStorage.setItem("vedchat_username", message.account?.username || "");
            myCode = message.account?.code || myCode;
            myName = message.name || message.account?.username || myName;
            myAvatar = message.avatar !== undefined ? message.avatar : myAvatar;
            localStorage.setItem("vedchat_code", myCode);
            localStorage.setItem("vedchat_name", myName);
            localStorage.setItem("vedchat_avatar", myAvatar);
            hideAuthScreen();
            if (ws && ws.readyState === WebSocket.OPEN) sendRaw({ type: "register", code: myCode, name: myName, avatar: myAvatar, authToken: message.authToken || localStorage.getItem("vedchat_auth_token") || "" });
            break;

        case "typing":
            updateTyping(message.from, true);
            break;

        case "typing-stop":
            updateTyping(message.from, false);
            break;

        case "vibes-list":
            vibes = Array.isArray(message.vibes) ? message.vibes : [];
            if (currentPage === "vibes") showVibes();
            break;

        case "vibe-saved":
            if (currentPage === "vibes") showVibes();
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

        case "friends-list": {
            const cachedFriends = Array.isArray(friends) ? friends : [];
            const serverFriends = Array.isArray(message.friends) ? message.friends : [];
            const byCode = {};

            cachedFriends.forEach(function(friend) {
                if (friend && friend.code) byCode[friend.code] = friend;
            });

            serverFriends.forEach(function(friend) {
                if (!friend || !friend.code) return;
                byCode[friend.code] = {
                    ...(byCode[friend.code] || {}),
                    ...friend
                };
            });

            friends = Object.keys(byCode).map(function(code) {
                return byCode[code];
            });

            localStorage.setItem(
                "vedchat_friends",
                JSON.stringify(friends)
            );

            if (
                currentPage ===
                "friends"
            ) {
                showFriends();
            }

            break;
        }

        case "friend-requests-list":
            friendRequests = {
                incoming: Array.isArray(message.incoming) ? message.incoming : [],
                outgoing: Array.isArray(message.outgoing) ? message.outgoing : []
            };
            localStorage.setItem("vedchat_friend_requests", JSON.stringify(friendRequests));
            if (currentPage === "friends") showFriends();
            break;

        case "friend-request":
            if (message.from && !friendRequests.incoming.some(r => (r.code || r.from) === message.from)) {
                friendRequests.incoming.push({ code: message.from, name: message.name || "VedChat user", avatar: message.avatar || "" });
                localStorage.setItem("vedchat_friend_requests", JSON.stringify(friendRequests));
            }
            uiToast("New friend request from " + (message.name || "a VedChat user"), "ok");
            if (currentPage === "friends") showFriends();
            send({type:"get-friend-requests"});
            break;

        case "friend-request-sent":
            uiToast("Friend request sent to " + (message.name || "your friend"), "ok");
            send({type:"get-friend-requests"});
            break;

        case "friend-request-accepted":
            uiToast("Friend request accepted!", "ok");
            getFriends();
            send({type:"get-friend-requests"});
            break;

        case "friend-request-declined":
            uiToast("Friend request declined.", "warn");
            send({type:"get-friend-requests"});
            break;

        case "friend-removed":
            friends = friends.filter(f => f.code !== message.code);
            localStorage.setItem("vedchat_friends", JSON.stringify(friends));
            if (currentPage === "friends") showFriends();
            break;

        case "friends-updated":
            getFriends();
            send({type:"get-friend-requests"});
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

        case "vibes":
            showHome();
            break;
        case "private-chat":
            receivePrivateMessage(
                message
            );
            break;

        case "message-updated":
            applyRemoteMessageUpdate(message);
            break;

        case "message-deleted":
            applyRemoteMessageDelete(message);
            break;

        case "typing":
            handleTyping(message);
            break;

        case "blocked-list":
            blockedUsers = Array.isArray(message.users) ? message.users : [];
            saveLocal();
            break;

        case "user-blocked":
            if (message.code && !blockedUsers.includes(message.code)) blockedUsers.push(message.code);
            saveLocal();
            if (currentPage === "friends") showFriends();
            break;

        case "user-unblocked":
            blockedUsers = blockedUsers.filter(code => code !== message.code);
            saveLocal();
            break;

        case "groups-list":
            groups =
                message.groups || groups || [];

            localStorage.setItem(
                "vedchat_groups",
                JSON.stringify(groups)
            );

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
            if (message.groupId) {
                const g = groups.find(function(x){ return x.id === message.groupId; });
                if (g && Array.isArray(g.members) && !g.members.includes(message.code)) g.members.push(message.code);
                localStorage.setItem("vedchat_groups", JSON.stringify(groups));
                if (currentPage === "groups") showGroups();
            }
            break;

        case "group-member-added":
            if (message.group) {
                addGroupLocally(message.group);
                localStorage.setItem("vedchat_groups", JSON.stringify(groups));
                if (currentPage === "groups") showGroups();
            }
            break;

        case "group-invite":
            if (message.group) {
                addGroupLocally(message.group);
                localStorage.setItem("vedchat_groups", JSON.stringify(groups));
                uiToast("Added to group: " + (message.group.name || "Group"), "ok");
                if (currentPage === "groups") showGroups();
            }
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
    serverRegistered = true;
    startHeartbeat();
    myCode =
        message.code || myCode;

    myName =
        message.name || myName;

    myAvatar =
        message.avatar || myAvatar;

    if (Array.isArray(message.friends) && message.friends.length) {
        const serverFriends = message.friends;
        friends = serverFriends.map(function(friend) {
            if (typeof friend === "string") {
                return getFriendByCode(friend);
            }
            return friend;
        });
    }

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

    localStorage.setItem(
        "vedchat_friends",
        JSON.stringify(friends)
    );

    getFriends();
    send({ type: "get-vibes" });
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

function handleFriendProfileUpdated(message) {
    const updated = message && message.user ? message.user : message;
    if (!updated || !updated.code) return;
    friends = friends.map(friend => friend.code === updated.code ? {
        ...friend,
        name: updated.name !== undefined ? updated.name : friend.name,
        avatar: updated.avatar !== undefined ? updated.avatar : friend.avatar,
        rank: updated.rank !== undefined ? updated.rank : friend.rank
    } : friend);

    localStorage.setItem(
        "vedchat_friends",
        JSON.stringify(friends)
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
    uiPrompt("Choose your name", "What should your friends see?", "Guest", function(value){
        const name = String(value || "Guest").trim().slice(0, 40) || "Guest";
        myName = name;
        localStorage.setItem("vedchat_name", myName);
        if (ws && ws.readyState === WebSocket.OPEN) sendRaw({type:"register", code:myCode, name:myName, avatar:myAvatar});
    });
}

function editProfile() {
    uiPrompt("Edit name", "Choose your new display name", myName, function(value){
        const name = String(value || "").trim().slice(0, 40);
        if (!name) return;
        send({type:"update-profile", name:name, avatar:myAvatar});
    });
}

function removeProfilePicture(){
    if(!myAvatar) return;
    uiConfirm("Remove profile picture", "Remove your current profile picture?", function(){
    myAvatar="";
    localStorage.removeItem("vedchat_avatar");
    if(connectionState==="connected") send({type:"update-profile",name:myName,avatar:""});
    showProfile();
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

function goBack() {
    switch (currentPage) {
        case "private-chat":
            showFriends();
            break;
        case "group-chat":
            showGroups();
            break;
        case "friends":
        case "groups":
        case "chats":
        case "connect":
        case "history":
        case "profile":
        case "bluetooth-offline":
            showHome();
            break;
        case "call":
            showHome();
            break;
        default:
            showHome();
    }
}

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
                    onclick="showVibes()"
                >
                    <span>✨</span>
                    <strong>Vibe</strong>
                    <small>24-hour updates</small>
                </button>

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

            <button class="wide-action" onclick="showVedAI()">
                <span class="wide-action-icon">🤖</span>
                <div><strong>Ved AI</strong><small>Your private offline assistant</small></div>
                <span class="wide-arrow">›</span>
            </button>

            <button
                class="wide-action"
                onclick="openBluetoothOffline()"
            >
                <span class="wide-action-icon">📡</span>
                <div>
                    <strong>Offline VedChat</strong>
                    <small>Bluetooth nearby messaging</small>
                </div>
                <span class="wide-arrow">›</span>
            </button>

            <button
                class="wide-action"
                onclick="showSupportVedChat()"
            >
                <span class="wide-action-icon">💙</span>
                <div>
                    <strong>Support VedChat</strong>
                    <small>Help, feedback & project info</small>
                </div>
                <span class="wide-arrow">›</span>
            </button>

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
   V10 ACCOUNTS + TYPING + VOICE + APP LOCK
===================================================== */

function showAuthScreen() {
    currentPage = "auth";
    render(`
      <main class="auth-screen">
        <section class="auth-card">
          <div class="auth-logo">💬</div>
          <div class="auth-kicker">PRIVATE • FAST • VEDCHAT</div>
          <h1>Welcome to VedChat</h1>
          <p class="auth-subtitle">Private chats, calls, Vibes and friends in one clean app.</p>
          <div class="auth-tabs">
            <button id="authLoginTab" class="auth-tab active" onclick="showAuthForm('login')">Sign in</button>
            <button id="authRegisterTab" class="auth-tab" onclick="showAuthForm('register')">Create account</button>
          </div>
          <div id="authForm"></div>
          <div class="auth-divider"><span>OR</span></div>
          <button class="auth-device-btn" onclick="continueLegacyAccount()">📱 Continue with this device</button>
          <p class="auth-footnote">Use an account to keep your VedChat identity available across device/browser storage resets.</p>
        </section>
      </main>`);
    showAuthForm("login");
}
function showAuthForm(mode) {
    const box=document.getElementById("authForm"); if(!box)return;
    const login = mode === "login";
    const tabLogin = document.getElementById("authLoginTab");
    const tabRegister = document.getElementById("authRegisterTab");
    if(tabLogin) tabLogin.className = "auth-tab" + (login ? " active" : "");
    if(tabRegister) tabRegister.className = "auth-tab" + (!login ? " active" : "");
    box.innerHTML=`
      <div class="auth-fields">
        ${!login ? '<div class="auth-helper">Create your VedChat identity</div>' : ''}
        <label class="auth-field"><span>Username</span><input id="authUser" maxlength="24" autocomplete="username" placeholder="Choose a username"></label>
        ${!login ? '<label class="auth-field"><span>Display name</span><input id="authName" maxlength="40" autocomplete="name" placeholder="What friends will see"></label>' : ''}
        <label class="auth-field"><span>Password</span><div class="auth-password"><input id="authPass" maxlength="100" autocomplete="current-password" type="password" placeholder="Enter your password"><button type="button" onclick="toggleAuthPassword()">Show</button></div></label>
        <button class="auth-submit" onclick="submitAuth('${mode}')">${login?'🔐 Sign in':'✨ Create my account'}</button>
      </div>`;
}
function toggleAuthPassword(){ const i=document.getElementById("authPass"); const b=i?.parentElement?.querySelector("button"); if(!i)return; i.type=i.type==="password"?"text":"password"; if(b)b.textContent=i.type==="password"?"Show":"Hide"; }
function submitAuth(mode) {
    const username=document.getElementById("authUser")?.value.trim(); const password=document.getElementById("authPass")?.value; const name=document.getElementById("authName")?.value.trim();
    if(!username||!password){showAuthError("Please enter your username and password.");return;}
    if(mode==='register' && (!name || name.length < 2)){showAuthError("Please choose a display name.");return;}
    if(connectionState!=="connected"){showAuthError("VedChat is connecting. Please try again in a moment.");return;}
    sendRaw({type:mode==='register'?'auth-register':'auth-login',username,password,name});
}
function showAuthError(text){ const box=document.getElementById("authForm"); if(!box)return; let e=document.getElementById("authError"); if(!e){e=document.createElement("div");e.id="authError";box.prepend(e);} e.style.cssText="margin-bottom:10px;padding:11px 13px;border-radius:14px;background:rgba(255,80,100,.12);border:1px solid rgba(255,80,100,.22);color:#ff9aa8;font-size:13px;"; e.textContent="⚠️ "+text; }
function hideAuthScreen(){ if(currentPage==='auth'){ showHome(); } }
function continueLegacyAccount(){
    const oldCode=localStorage.getItem("vedchat_code")||"";
    if(!oldCode){ showAuthError("This device has no old VedChat identity. Create an account to continue."); return; }
    const existing=localStorage.getItem("vedchat_name")||"";
    render(`
      <main class="auth-screen">
        <section class="auth-card compact">
          <button class="modal-close top-left-back" onclick="showAuthScreen()">←</button>
          <div class="auth-logo">👋</div>
          <div class="auth-kicker">THIS DEVICE</div>
          <h1>Choose your name</h1>
          <p class="auth-subtitle">This keeps your existing VedChat identity and does not create a new account.</p>
          <label class="auth-field"><span>Display name</span><input id="legacyName" maxlength="40" value="${escapeHTML(existing)}" placeholder="Your name"></label>
          <button class="auth-submit" onclick="finishLegacyAccount()">Continue to VedChat</button>
        </section>
      </main>`);
    setTimeout(()=>document.getElementById("legacyName")?.focus(),80);
}
function finishLegacyAccount(){
    let name=String(document.getElementById("legacyName")?.value||"").trim().slice(0,40)||"Guest";
    myName=name; myCode=localStorage.getItem("vedchat_code")||""; localStorage.setItem("vedchat_name",myName);
    if(!myCode){ showAuthError("This device has no old VedChat identity. Create an account to continue."); return; }
    showHome(); if(ws&&ws.readyState===WebSocket.OPEN) sendRaw({type:"register",code:myCode,name:myName,avatar:myAvatar});
}

function updateTyping(code, active){
    if(code!==currentFriend) return;
    typingFriend = active ? code : null;
    const el=document.getElementById("typingStatus"); if(el) el.style.display=active?"inline":"none";
    const f=friends.find(x=>x.code===code); if(f){f.typing=active;}
}
function sendTyping(code){
    if(!code || connectionState!=="connected") return;
    if(!typingActive){ typingActive=true; sendRaw({type:"typing-start",to:code}); }
    clearTimeout(typingTimer);
    typingTimer=setTimeout(()=>{typingActive=false;sendRaw({type:"typing-stop",to:code});},1200);
}
function stopTyping(){ if(typingActive&&currentFriend){typingActive=false;sendRaw({type:"typing-stop",to:currentFriend});} clearTimeout(typingTimer); }

async function toggleVoiceRecording(){
    if(voiceRecorder && voiceRecorder.state === "recording"){ voiceRecorder.stop(); return; }
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ alert("Voice messages are not supported on this device/browser."); return; }
    try{
        const stream=await navigator.mediaDevices.getUserMedia({audio:true});
        voiceChunks=[]; voiceStartedAt=Date.now();
        voiceRecorder=new MediaRecorder(stream);
        voiceRecorder.ondataavailable=e=>{if(e.data.size)voiceChunks.push(e.data);};
        voiceRecorder.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); finishVoiceRecording(); };
        voiceRecorder.start();
        const b=document.getElementById("voiceRecordBtn"); if(b){b.textContent="⏹️";b.classList.add("recording");}
        setTimeout(()=>{if(voiceRecorder&&voiceRecorder.state==='recording')voiceRecorder.stop();},20000);
    }catch(e){alert("Microphone permission is required for voice messages.");}
}
async function finishVoiceRecording(){
    const b=document.getElementById("voiceRecordBtn"); if(b){b.textContent="🎤";b.classList.remove("recording");}
    const blob=new Blob(voiceChunks,{type:voiceRecorder?.mimeType||"audio/webm"});
    if(blob.size>2*1024*1024){alert("Voice message is too large. Keep it under 2 MB.");return;}
    const reader=new FileReader(); reader.onload=()=>{send({type:"voice-message",to:currentFriend,data:reader.result,duration:Math.round((Date.now()-voiceStartedAt)/1000)});}; reader.readAsDataURL(blob);
    voiceRecorder=null; voiceChunks=[];
}


function signOutAccount(){
    uiConfirm("Sign out", "Sign out of this VedChat account on this device?", function(){
    localStorage.removeItem("vedchat_auth_token");
    localStorage.removeItem("vedchat_username");
    localStorage.removeItem("vedchat_code");
    localStorage.removeItem("vedchat_name");
    localStorage.removeItem("vedchat_avatar");
    myCode=""; myName=""; myAvatar="";
    try{ if(ws) ws.close(); }catch{}
    showAuthScreen();
    });
}

function formatLastSeen(value){
    const d=new Date(value); if(Number.isNaN(d.getTime()))return "recently";
    const diff=Date.now()-d.getTime(); if(diff<60000)return "just now"; if(diff<3600000)return Math.floor(diff/60000)+"m ago";
    if(diff<86400000)return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); return d.toLocaleDateString([], {day:"numeric",month:"short"});
}

async function hashPin(pin){ const data=new TextEncoder().encode(pin); const buf=await crypto.subtle.digest("SHA-256",data); return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,"0")).join(""); }
async function setAppLock(){ uiPrompt("App Lock", "Create a 4–8 digit app PIN", "", async function(pin){ if(!/^\d{4,8}$/.test(pin||"")){alert("Use 4–8 digits.");return;} localStorage.setItem("vedchat_app_lock",await hashPin(pin)); alert("🔒 App Lock enabled."); }); }
async function disableAppLock(){ uiPrompt("App Lock", "Enter your app PIN", "", async function(pin){ if(await hashPin(pin||"")===localStorage.getItem("vedchat_app_lock")){localStorage.removeItem("vedchat_app_lock");alert("App Lock disabled.");}else alert("Incorrect PIN."); }); }
async function lockAppNow(){ if(localStorage.getItem("vedchat_app_lock")){appLockLocked=true;showAppLock();} }
function showAppLock(){ render(`<main class="auth-screen"><div class="auth-logo">🔒</div><h1>VedChat Locked</h1><p class="setting-description">Enter your app PIN to continue.</p><div class="setting"><input id="unlockPin" type="password" inputmode="numeric" maxlength="8" placeholder="PIN"><button class="primary-btn" onclick="unlockApp()">Unlock</button></div></main>`); setTimeout(()=>document.getElementById("unlockPin")?.focus(),100); }
async function unlockApp(){ const pin=document.getElementById("unlockPin")?.value||""; if(await hashPin(pin)===localStorage.getItem("vedchat_app_lock")){appLockLocked=false;showHome();}else alert("Incorrect PIN."); }

/* =====================================================
   VIBE
===================================================== */

function requestVibes() {
    send({ type: "get-vibes" });
}

function showVibes() {
    currentPage = "vibes";
    requestVibes();

    const own = vibes.filter(v => v.owner === myCode);
    const friendsVibes = vibes.filter(v => v.owner !== myCode);
    const owners = [];
    friendsVibes.forEach(v => { if (!owners.some(x => x.owner === v.owner)) owners.push(v); });

    render(`
        <header class="topbar">
            <div>
                <h1>✨ Vibes</h1>
                <small>Your 24-hour updates</small>
            </div>
            <button class="icon-btn" onclick="showHome()">←</button>
        </header>
        <main>
            <section class="profile-card" onclick="showVibeComposer()" style="cursor:pointer;">
                ${avatarHTML(myAvatar, myName, 58)}
                <h2>My Vibe</h2>
                <p>${own.length ? own.length + " active Vibe" + (own.length === 1 ? "" : "s") : "Tap to add a Vibe"}</p>
            </section>
            <button class="primary-btn" onclick="showVibeComposer()">✨ Add Vibe</button>
            <h3 style="margin-top:20px;">Friends' Vibes</h3>
            ${owners.length ? owners.map(v => `
                <button class="wide-action" onclick="openVibe('${escapeHTML(v.owner)}')">
                    ${avatarHTML(v.avatar, v.name, 48)}
                    <div><strong>${escapeHTML(v.name)}</strong><small>✨ New Vibe</small></div><span>›</span>
                </button>`).join("") : `<div class="setting"><div class="setting-title">No new Vibes</div><div class="setting-description">When a friend posts one, it will appear here.</div></div>`}
            ${own.length ? `<h3 style="margin-top:20px;">Your Vibes</h3>${own.map(v => `<div class="setting"><div class="setting-title">${escapeHTML(v.text || "📸 Photo Vibe")}</div><div class="setting-description">Expires in 24 hours</div><button class="danger-btn" onclick="deleteVibe('${escapeHTML(v.id)}')">Delete</button></div>`).join("")}` : ""}
        </main>
        ${bottomNav("vibes")}
    `);
}

function showVibeComposer() {
    currentPage = "vibe-composer";
    render(`
        <header class="topbar"><div><h1>✨ New Vibe</h1><small>Share something for 24 hours</small></div><button class="icon-btn" onclick="showVibes()">←</button></header>
        <main>
            <div class="setting">
                <div class="setting-title">📝 Text</div>
                <textarea id="vibeText" maxlength="500" placeholder="What's your Vibe?" style="width:100%;min-height:100px;box-sizing:border-box;"></textarea>
            </div>
            <div class="setting">
                <div class="setting-title">📸 Photo</div>
                <input id="vibeImage" type="file" accept="image/*" onchange="previewVibeImage(event)">
                <div id="vibePreview" style="margin-top:10px;"></div>
            </div>
            <div class="setting">
                <div class="setting-title">🎵 Music / audio</div>
                <input id="vibeAudio" type="file" accept="audio/*">
                <div class="setting-description">Use audio you created or have permission to share. Max 2 MB.</div>
            </div>
            <button class="primary-btn" onclick="publishVibe()">✨ Publish Vibe</button>
            <button class="secondary-btn" onclick="showVibes()">Cancel</button>
        </main>
    `);
}

function previewVibeImage(event) {
    const file = event.target.files?.[0];
    const box = document.getElementById("vibePreview");
    if (!file || !box) return;
    if (file.size > 4 * 1024 * 1024) { box.textContent = "Photo is too large. Keep it under 4 MB."; event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { box.innerHTML = `<img src="${escapeHTML(reader.result)}" style="max-width:100%;max-height:280px;border-radius:16px;">`; };
    reader.readAsDataURL(file);
}

function publishVibe() {
    const text=document.getElementById("vibeText")?.value.trim()||"";
    const imageFile=document.getElementById("vibeImage")?.files?.[0];
    const audioFile=document.getElementById("vibeAudio")?.files?.[0];
    if(!text&&!imageFile&&!audioFile){alert("Add text, a photo, or audio first.");return;}
    if(imageFile&&imageFile.size>4*1024*1024){alert("Photo is too large. Keep it under 4 MB.");return;}
    if(audioFile&&audioFile.size>2*1024*1024){alert("Audio is too large. Keep it under 2 MB.");return;}
    const read=(file)=>new Promise((resolve,reject)=>{if(!file)return resolve("");const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    Promise.all([read(imageFile),read(audioFile)]).then(([image,audio])=>{send({type:"set-vibe",text,image,audio,audioDuration:0});showVibes();});
}

function openVibe(owner) {
    const list = vibes.filter(v => v.owner === owner);
    if (!list.length) { requestVibes(); return; }
    currentVibeIndex = 0;
    showVibeViewer(list);
}

function showVibeViewer(list) {
    const v = list[currentVibeIndex];
    if (!v) { showVibes(); return; }
    send({ type: "view-vibe", id: v.id, owner: v.owner });
    render(`
        <header class="topbar"><div><h1>✨ ${escapeHTML(v.name)}</h1><small>${new Date(v.createdAt).toLocaleString()}</small></div><button class="icon-btn" onclick="showVibes()">×</button></header>
        <main>
            ${v.image ? `<img src="${escapeHTML(v.image)}" style="width:100%;max-height:60vh;object-fit:contain;border-radius:18px;">` : ""}
            ${v.audio ? `<div class="setting"><div class="setting-title">🎵 Vibe audio</div><audio controls src="${escapeHTML(v.audio)}" style="width:100%;"></audio></div>` : ""}
            ${v.text ? `<div class="profile-card"><h2>${escapeHTML(v.text)}</h2></div>` : ""}
            <div style="display:flex;gap:10px;">
                <button class="secondary-btn" onclick="currentVibeIndex=Math.max(0,currentVibeIndex-1);showVibeViewer(vibes.filter(x=>x.owner==='${escapeHTML(v.owner)}'))">‹</button>
                <button class="primary-btn" onclick="currentVibeIndex++;showVibeViewer(vibes.filter(x=>x.owner==='${escapeHTML(v.owner)}'))">Next ›</button>
            </div>
        </main>
    `);
}

function deleteVibe(id) {
    uiConfirm("Delete Vibe", "Delete this Vibe?", function(){
    send({ type: "delete-vibe", id });
    setTimeout(requestVibes, 100);
    });
}

/* =====================================================
   VED AI
===================================================== */
function showVedAI() {
    currentPage = "ved-ai";
    render(`
        <header class="topbar"><div class="topbar-title-wrap"><button class="top-back" onclick="showHome()">←</button><div><h1>🤖 Ved AI</h1><small>Private offline assistant</small></div></div></header>
        <main class="ai-main">
            <section class="ai-hero"><div class="ai-orb">🤖</div><h2>Hey ${escapeHTML(myName || "Vedant")} 👋</h2><p>Ask me about VedChat, your features, or simple everyday questions.</p></section>
            <div id="vedAiMessages" class="ai-messages"><div class="ai-bubble ai-bot">Hi! I'm Ved AI. I'm currently a private offline assistant built into VedChat.</div></div>
            <div class="ai-composer"><input id="vedAiInput" placeholder="Ask Ved AI…" onkeydown="if(event.key==='Enter') sendVedAI()"><button onclick="sendVedAI()">➤</button></div>
        </main>
        ${bottomNav("home")}
    `);
}
function sendVedAI() {
    const input=document.getElementById("vedAiInput"); const box=document.getElementById("vedAiMessages"); if(!input||!box) return;
    const q=input.value.trim(); if(!q) return; input.value="";
    const mine=document.createElement("div"); mine.className="ai-bubble ai-user"; mine.textContent=q; box.appendChild(mine);
    const l=q.toLowerCase(); let answer="I'm still learning. Try asking me about VedChat features, Vibes, groups, calls, friends, or how to use the app.";
    if(l.includes("vibe")||l.includes("status")) answer="Vibes are VedChat's 24-hour status feature. Friends can see active Vibes, and you can post text, photos, or audio.";
    else if(l.includes("group")) answer="Group chats let you create a group and, when you're the owner, add friends using their 10-character VedChat code.";
    else if(l.includes("connect")||l.includes("friend")) answer="Use Connect to enter a friend's 10-character code, view their profile, and send a friend request.";
    else if(l.includes("call")||l.includes("ring")) answer="Incoming calls keep the ringtone playing until you answer, decline, or the call ends.";
    else if(l.includes("vedchat")) answer="VedChat includes private chats, groups, friends, Vibes, calls, voice messages, profiles, QR Connect and more.";
    const bot=document.createElement("div"); bot.className="ai-bubble ai-bot"; bot.textContent=answer; box.appendChild(bot); box.scrollTop=box.scrollHeight;
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
            <div class="topbar-title-wrap">
                <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
                <div>
                <h1>Connect</h1>
                <small>
                    Add a VedChat friend
                </small>
                </div>
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
    if (!serverRegistered) { uiToast("Please sign in and connect first.", "warn"); return; }
    send({ type: "add-friend", code });
}

function respondFriendRequest(code, accept) {
    if (!serverRegistered) { uiToast("Please sign in and connect first.", "warn"); return; }
    send({type: accept ? "accept-friend-request" : "decline-friend-request", code});
    friendRequests.incoming = friendRequests.incoming.filter(r => (r.code || r.from) !== code);
    friendRequests.outgoing = friendRequests.outgoing.filter(r => (r.code || r.to) !== code);
    localStorage.setItem("vedchat_friend_requests", JSON.stringify(friendRequests));
    showFriends();
    setTimeout(() => send({type:"get-friend-requests"}), 250);
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
                    online: !!message.online,
                    lastSeen: message.lastSeen || friend.lastSeen || null
                }
                : friend
        );

    localStorage.setItem(
        "vedchat_friends",
        JSON.stringify(friends)
    );

    if (
        currentPage ===
        "friends"
    ) {
        showFriends();
    }
}

function showFriends() {
    showSocial("friends");
}

function removeFriend(code){
    const friend=friends.find(f=>f.code===code);
    if(!friend) return;
    uiConfirm("Remove friend", `Remove ${friend.name || "this friend"} from your friends?`, function(){
    send({type:"remove-friend",code});
    friends=friends.filter(f=>f.code!==code);
    localStorage.setItem("vedchat_friends",JSON.stringify(friends));
    if(currentFriend===code){currentFriend=null;showFriends();} else {showFriends();}
    });
}

function showGroups() {
    showSocial("groups");
}

function showSocial(tab = "friends") {
    currentPage = tab;

    render(`
        <header class="topbar social-topbar">
            <div class="brand">
                <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
                <div class="brand-bubble">💬</div>
                <div>
                    <h1>VedChat</h1>
                </div>
            </div>

            <div class="top-actions">
                <button class="top-icon" onclick="showConnect()" aria-label="Add friend">＋</button>
                <button class="top-icon" onclick="showProfile()" aria-label="Profile">👤</button>
            </div>
        </header>

        <main class="social-main">
            <div class="social-tabs">
                <button
                    class="social-tab ${tab === "friends" ? "active" : ""}"
                    onclick="showFriends()"
                >
                    Friends
                </button>
                <button
                    class="social-tab ${tab === "groups" ? "active" : ""}"
                    onclick="showGroups()"
                >
                    Groups
                </button>
            </div>

            <div class="social-content">
                ${tab === "friends" ? `
                    <button class="primary-btn social-add" onclick="showConnect()">
                        ＋ Add Friend
                    </button>
                    <section id="friendRequestsPanel" class="card" style="margin:12px 0;padding:14px;">
                      <h3 style="margin:0 0 10px;">Friend requests <span style="opacity:.7;font-size:12px;">(${friendRequests.incoming.length})</span></h3>
                      ${friendRequests.incoming.length ? friendRequests.incoming.map(r => `
                        <div class="friend-item" style="display:flex;align-items:center;gap:10px;padding:9px 0;">
                          ${avatarHTML(r.avatar || "", r.name || "User", 42)}
                          <div class="friend-info" style="flex:1;min-width:0;"><strong>${escapeHTML(r.name || "VedChat user")}</strong><small>${escapeHTML(r.code || r.from || "")}</small></div>
                          <button class="primary-btn" style="padding:7px 10px;" onclick="respondFriendRequest('${escapeHTML(r.code || r.from || "")}',true)">Accept</button>
                          <button class="secondary-btn" style="padding:7px 10px;" onclick="respondFriendRequest('${escapeHTML(r.code || r.from || "")}',false)">Decline</button>
                        </div>`).join("") : '<p style="opacity:.7;margin:0;">No incoming requests.</p>'}
                      ${friendRequests.outgoing.length ? `<p style="opacity:.7;margin:10px 0 0;font-size:12px;">Pending: ${friendRequests.outgoing.map(r => escapeHTML(r.name || r.code || r.to || "User")).join(", ")}</p>` : ""}
                    </section>
                    <div id="friendsList" class="social-list"></div>
                ` : `
                    <button class="primary-btn social-add" onclick="createGroup()">
                        ＋ Create Group
                    </button>
                    <div id="groupList" class="social-list"></div>
                `}
            </div>
        </main>
        ${bottomNav(tab === "friends" ? "friends" : "groups")}
    `);

    if (tab === "friends") {
        if (serverRegistered) send({type:"get-friend-requests"});
        const list = document.getElementById("friendsList");
        if (!list) return;

        if (!friends.length) {
            list.innerHTML = `
                <div class="empty social-empty">
                    <div class="empty-icon">🧑‍🤝‍🧑</div>
                    <h3>No friends yet</h3>
                    <p>Add someone using their VedChat code.</p>
                </div>
            `;
            return;
        }

        friends.forEach(friend => {
            const item = document.createElement("div");
            item.className = "friend-item social-item";
            item.onclick = () => openPrivateChat(friend.code);
            item.innerHTML = `
                ${avatarHTML(friend.avatar, friend.name, 52)}
                <div class="friend-info">
                    <strong>${escapeHTML(friend.name)}</strong>
                    <small>${friend.online ? "🟢 Online" : (friend.lastSeen ? "🕐 Last seen " + formatLastSeen(friend.lastSeen) : "⚪ Offline")}</small>
                </div>
                <button class="small-action" title="Chat" onclick="event.stopPropagation(); openPrivateChat('${escapeHTML(friend.code)}')">💬</button>
                <button class="small-action" title="Call" onclick="event.stopPropagation(); startPrivateCall('${escapeHTML(friend.code)}', 'audio')">📞</button>
                <button class="small-action danger-action" title="Remove friend" onclick="event.stopPropagation(); removeFriend('${escapeHTML(friend.code)}')">🗑️</button>
            `;
            list.appendChild(item);
        });
    } else {
        const list = document.getElementById("groupList");
        if (!list) return;

        if (!groups.length) {
            list.innerHTML = `
                <div class="empty social-empty">
                    <div class="empty-icon">👥</div>
                    <h3>No groups yet</h3>
                    <p>Create a group and invite friends.</p>
                </div>
            `;
            return;
        }

        groups.forEach(group => {
            const item = document.createElement("div");
            item.className = "group-item social-item";
            item.onclick = () => openGroupChat(group.id);
            item.innerHTML = `
                <div class="group-icon">👥</div>
                <div class="friend-info">
                    <strong>${escapeHTML(group.name)}</strong>
                    <small>${Array.isArray(group.members) ? group.members.length : 0} members</small>
                </div>
                ${group.owner === myCode ? `<button class="small-action" title="Add member" onclick="event.stopPropagation(); addGroupMember('${escapeHTML(group.id)}')">＋</button>` : ""}
                <span class="arrow">›</span>
            `;
            list.appendChild(item);
        });
    }
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

    const messages =
        getPrivateMessages(
            other
        );

    messages.push(message);

    if (message.from !== myCode && !(currentPage === "private-chat" && currentFriend === other)) {
        showNotification(message.sender || "New message", message.text || "New VedChat message", "message");
    }

    if (messages.length > 1000) {
        messages.splice(
            0,
            messages.length - 1000
        );
    }

    saveLocal();

    if (
        currentPage ===
            "private-chat" &&
        currentFriend ===
            other
    ) {
        displayPrivateMessages();
    }
}

function getFriendByCode(code) {
    const friend = friends.find(function(item) {
        return item.code === code;
    });

    if (friend) return friend;

    const messages = privateMessages[code] || [];
    const last = messages.length ? messages[messages.length - 1] : null;

    if (last && (last.sender || last.avatar)) {
        return {
            code: code,
            name: last.sender || "User",
            avatar: last.avatar || "",
            online: false
        };
    }

    return {
        code: code,
        name: "User",
        avatar: "",
        online: false
    };
}

function openPrivateChat(code) {
    currentFriend =
        code;

    currentPage =
        "private-chat";

    const friend =
        getFriendByCode(code);

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
                    ${friend?.online ? "🟢 Online" : (friend?.lastSeen ? "🕐 Last seen " + formatLastSeen(friend.lastSeen) : "⚪ Offline")}<span id="typingStatus" style="display:${typingFriend === code ? "inline" : "none"};color:#a5b4fc;margin-left:5px;">typing…</span>
                </small>

            </div>

            <button
                class="icon-btn"
                onclick="startPrivateCall('${escapeHTML(code)}', 'video')"
                title="Video call"
            >
                📹
            </button>

            <button
                class="icon-btn"
                onclick="startPrivateCall('${escapeHTML(code)}', 'audio')"
                title="Audio call"
            >
                📞
            </button>

            <button
                class="icon-btn"
                onclick="toggleBlockUser('${escapeHTML(code)}')"
                title="Block / unblock"
            >
                ${blockedUsers.includes(code) ? "🔓" : "🚫"}
            </button>

        </header>

        <main class="chat-page">

            <div
                id="privateMessageArea"
                class="message-area"
            ></div>

            <div id="typingIndicator" class="typing-indicator"></div>

            <div id="emojiPicker" class="emoji-picker" style="display:none">
                ${["😀","😂","😍","😎","😭","😡","👍","👎","❤️","🔥","🎉","👏","🙏","💀","🤔","😴","🤣","🥳","✨","💯","👀","🙌","😊","😅"].map(e => `<button type="button" onclick="insertEmoji('${e}')">${e}</button>`).join("")}
            </div>

            <div class="composer">
                <button type="button" class="composer-icon" onclick="toggleEmojiPicker()">😀</button>
                <button type="button" class="composer-icon" onclick="pickChatImage()">🖼️</button>
                <input id="chatImageInput" type="file" accept="image/*" style="display:none" onchange="sendChatImage(this)">
                <input
                    id="privateMessageInput"
                    placeholder="Message..."
                    maxlength="5000"
                    autocomplete="off"
                >
                <button onclick="sendPrivateMessage()">➤</button>
            </div>

        </main>
    `);

    const input =
        document.getElementById(
            "privateMessageInput"
        );

    input?.addEventListener("input", () => sendTyping(currentFriend));

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

    setTimeout(
        () => input?.focus(),
        100
    );
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

    if (!currentFriend) return;

    if (blockedUsers.includes(currentFriend)) {
        alert("This user is blocked. Unblock them to send messages.");
        return;
    }

    send({
        type: "private-chat",
        to: currentFriend,
        text,
        messageId: cryptoRandomId()
    });

    sendTypingSignal(false);
    input.value = "";
    document.getElementById("emojiPicker")?.style.setProperty("display", "none");
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
        (message, messageIndex) => {
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
                                    friendName(currentFriend)
                                )}
                            </strong>
                        `
                        : ""
                }

                ${message.image ? `<img class="chat-image" src="${escapeHTML(message.image)}" alt="Image" onclick="window.open('${escapeHTML(message.image)}','_blank')">` : `<div>${escapeHTML(message.text || "")}</div>`}

                ${message.edited ? `<small class="edited-label">edited</small>` : ""}

                <span class="message-time">
                    ${formatTime(
                        message.time
                    )}
                </span>

                ${mine ? `<button class="message-delete-btn" onclick="editPrivateMessage(${messageIndex})" title="Edit message">✏️</button>` : ""}
                <button class="message-delete-btn" onclick="deletePrivateMessage(${messageIndex})" title="Delete for me">🗑️</button>
                ${mine && message.messageId ? `<button class="message-delete-btn" onclick="deleteForEveryone(${messageIndex})" title="Delete for everyone">🗑️🌐</button>` : ""}
            `;

            area.appendChild(
                bubble
            );
        }
    );

    area.scrollTop =
        area.scrollHeight;
}

function deletePrivateMessage(index) {
    if (!currentFriend) return;
    const messages = getPrivateMessages(currentFriend);
    if (index < 0 || index >= messages.length) return;
    uiConfirm("Delete message", "Delete this message from your device?", function(){
        messages.splice(index, 1);
        saveLocal();
        displayPrivateMessages();
    });
}

function editPrivateMessage(index) {
    if (!currentFriend) return;
    const messages = getPrivateMessages(currentFriend);
    const message = messages[index];
    if (!message || message.from !== myCode || message.image) return;
    uiPrompt("Edit message", "Update your message", message.text || "", function(edited){
        const text = String(edited || "").trim();
        if (!text || text === message.text) return;
        message.text = text.slice(0, 5000);
        message.edited = true;
        saveLocal();
        displayPrivateMessages();
        if (message.messageId) send({type:"edit-message", to:currentFriend, messageId:message.messageId, text:message.text});
    });
}

function deleteForEveryone(index) {
    if (!currentFriend) return;
    const messages = getPrivateMessages(currentFriend);
    const message = messages[index];
    if (!message || message.from !== myCode || !message.messageId) return;
    uiConfirm("Delete for everyone", "Delete this message for everyone?", function(){
        message.deleted = true;
        message.text = "This message was deleted";
        delete message.image;
        saveLocal();
        displayPrivateMessages();
        send({type:"delete-for-everyone", to:currentFriend, messageId:message.messageId});
    });
}

function applyRemoteMessageUpdate(message) {
    const other = message.from === myCode ? message.to : message.from;
    const list = getPrivateMessages(other);
    const item = list.find(m => m.messageId === message.messageId);
    if (item && item.from === message.from) { item.text = message.text || ""; item.edited = true; saveLocal(); if (currentFriend === other) displayPrivateMessages(); }
}

function applyRemoteMessageDelete(message) {
    const other = message.from === myCode ? message.to : message.from;
    const list = getPrivateMessages(other);
    const item = list.find(m => m.messageId === message.messageId);
    if (item) { item.deleted = true; item.text = "This message was deleted"; delete item.image; saveLocal(); if (currentFriend === other) displayPrivateMessages(); }
}

function sendTypingSignal(isTyping) {
    if (!currentFriend || connectionState !== "connected" || blockedUsers.includes(currentFriend)) return;
    send({type:"typing", to:currentFriend, isTyping:!!isTyping});
}

function handleTyping(message) {
    if (!message.from || message.from !== currentFriend) return;
    friendTyping[message.from] = !!message.isTyping;
    const el = document.getElementById("typingIndicator");
    if (el) el.innerHTML = message.isTyping ? `<span>${escapeHTML(friendName(message.from))} is typing <b>...</b></span>` : "";
}

function toggleBlockUser(code) {
    if (!code) return;
    if (blockedUsers.includes(code)) {
        if (!confirm("Unblock this user?")) return;
        send({type:"unblock-user", code});
        blockedUsers = blockedUsers.filter(x => x !== code);
        saveLocal();
        openPrivateChat(code);
    } else {
        if (!confirm("Block this user? They will not be able to message or call you.")) return;
        send({type:"block-user", code});
        if (!blockedUsers.includes(code)) blockedUsers.push(code);
        saveLocal();
        openPrivateChat(code);
    }
}

function toggleEmojiPicker() {
    const p = document.getElementById("emojiPicker");
    if (p) p.style.display = p.style.display === "none" ? "grid" : "none";
}
function insertEmoji(emoji) {
    const input = document.getElementById("privateMessageInput");
    if (!input) return;
    input.value += emoji;
    input.focus();
}
function pickChatImage() { document.getElementById("chatImageInput")?.click(); }

async function sendChatImage(input) {
    if (!input || !input.files || !input.files[0] || !currentFriend) return;
    if (blockedUsers.includes(currentFriend)) { alert("This user is blocked."); input.value=""; return; }
    const file = input.files[0];
    if (!file.type.startsWith("image/")) { alert("Please choose an image."); input.value=""; return; }
    if (file.size > 8 * 1024 * 1024) { alert("Image is too large. Choose an image under 8 MB."); input.value=""; return; }
    try {
        const data = await resizeImageForChat(file);
        send({type:"private-chat", to:currentFriend, text:"", image:data, messageId:cryptoRandomId()});
    } catch(e) { alert("Could not prepare image."); }
    input.value="";
}

function resizeImageForChat(file) {
    return new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>{
            const img=new Image();
            img.onload=()=>{
                const max=1280, scale=Math.min(1,max/Math.max(img.width,img.height));
                const c=document.createElement("canvas"); c.width=Math.max(1,Math.round(img.width*scale)); c.height=Math.max(1,Math.round(img.height*scale));
                const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,c.width,c.height);
                resolve(c.toDataURL("image/jpeg",0.78));
            }; img.onerror=reject; img.src=reader.result;
        }; reader.onerror=reject; reader.readAsDataURL(file);
    });
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

function createGroup() {
    uiPrompt("Create group", "Enter a group name", "My Group", function(value){
        const name = String(value || "").trim().slice(0, 40);
        if (!name) return;
        send({type:"create-group", name:name});
    });
}

function addGroupMember(groupId) {
    const group = groups.find(function(g){ return g.id === groupId; });
    if (!group) return;
    uiPrompt("Add group member", "Enter the friend's 10-character VedChat code", "", function(value){
        const code = String(value || "").trim().toUpperCase();
        if (code.length !== 10) { uiToast("Enter a valid 10-character code.", "error"); return; }
        send({type:"add-group-member", groupId:groupId, code:code});
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

    setTimeout(
        () => input?.focus(),
        100
    );
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

    if (message.from !== myCode && !(currentPage === "group-chat" && currentGroup === message.groupId)) {
        showNotification(
            message.sender || "New group message",
            message.text || "New VedChat group message",
            "message"
        );
    }

    if (
        groupMessages[
            message.groupId
        ].length > 1000
    ) {
        groupMessages[
            message.groupId
        ].splice(
            0,
            groupMessages[
                message.groupId
            ].length - 1000
        );
    }

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

                ${message.image ? `<img class="chat-image" src="${escapeHTML(message.image)}" alt="Image" onclick="window.open('${escapeHTML(message.image)}','_blank')">` : `<div>${escapeHTML(message.text || "")}</div>`}

                ${message.edited ? `<small class="edited-label">edited</small>` : ""}

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

async function getCallMedia(mode) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone/camera unavailable in this WebView.");
    }

    if (mode === "audio") {
        return navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        });
    }

    return navigator.mediaDevices.getUserMedia({
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: {
            facingMode: "user",
            width: { ideal: 1080 },
            height: { ideal: 1920 }
        }
    });
}

async function getMicrophone() {
    return getCallMedia("audio");
}

function waitForCallPermissions(mode = "audio") {
    return new Promise(function(resolve) {
        if (!window.AndroidBluetooth || !AndroidBluetooth.requestCallPermissions) {
            resolve("granted");
            return;
        }

        var finished = false;
        var timer = setTimeout(function() {
            if (!finished) {
                finished = true;
                resolve("timeout");
            }
        }, 30000);

        window.onCallPermissionsReady = function(status) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(status || "denied");
        };

        try {
            AndroidBluetooth.requestCallPermissions("onCallPermissionsReady", mode);
        } catch (e) {
            finished = true;
            clearTimeout(timer);
            resolve("error");
        }
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
            if (event.track && event.track.kind === "video") {
                let video = document.getElementById("video-" + peerId);
                if (!video) { video=document.createElement("video"); video.id="video-"+peerId; video.autoplay=true; video.playsInline=true; video.className="remote-video"; document.getElementById("remoteVideos")?.appendChild(video); }
                if (event.streams && event.streams[0]) video.srcObject=event.streams[0];
                return;
            }
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

    const audio = document.getElementById("audio-" + peerId);
    const video = document.getElementById("video-" + peerId);
    if (audio) audio.remove();
    if (video) video.remove();
}

/* =====================================================
   PRIVATE CALL
===================================================== */

async function startPrivateCall(
    code
) {
    var permissionStatus = await waitForCallPermissions();

    if (permissionStatus !== "granted") {
        if (permissionStatus === "denied") {
            alert(mode === "audio" ? "VedChat needs microphone permission to start an audio call." : "VedChat needs microphone and camera permission to start a video call.");
        } else if (permissionStatus === "timeout") {
            alert(mode === "audio" ? "Microphone permission timed out. Please check Android app permissions." : "Microphone/camera permission timed out. Please check Android app permissions.");
        } else {
            alert(mode === "audio" ? "Could not request microphone permission." : "Could not request microphone/camera permission.");
        }
        return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert("Microphone access is not available in this Android WebView.");
        return;
    }
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
            await getCallMedia(mode);

        const callId =
            cryptoRandomId();

        currentCall = {
            callId,
            type: "private",
            mode,
            target: code,
            groupId: null,
            startedAt:
                new Date().toISOString()
        };

        await showCallUI(
            mode === "audio" ? "Calling..." : "Calling...",
            mode
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
            mode,
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

        var reason = error && error.message ? error.message : "microphone/WebRTC unavailable";
        if (error && error.name === "NotReadableError") {
            reason = "Could not start audio source. Another app may be using the microphone, or Android did not allow the WebView to access it.";
        }
        alert("Could not start the call: " + reason);

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

    startRingtone();
    showNotification(
        message.sender || "Incoming call",
        incomingCall.mode === "video" ? "Incoming VedChat video call" : "Incoming VedChat audio call",
        "call"
    );
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
                ${incomingCall.mode === "video" ? "📹" : "📞"}
            </div>

            <h1>
                ${incomingCall.mode === "video" ? "Incoming video call" : "Incoming audio call"}
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

    const call = incomingCall;

    try {
        const callMode = call.mode === "video" ? "video" : "audio";
        const permissionStatus = await waitForCallPermissions(callMode);
        if (permissionStatus !== "granted") { alert(callMode === "audio" ? "VedChat needs microphone permission to answer an audio call." : "VedChat needs microphone and camera permission to answer a video call."); return; }
        localStream = await getCallMedia(callMode);

        currentCall = {
            callId:
                call.callId,
            type:
                call.groupId
                    ? "group"
                    : "private",
            mode: callMode,
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
            "Connected",
            callMode
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
        var groupPermission = await waitForCallPermissions("audio");
        if (groupPermission !== "granted") { alert("VedChat needs microphone permission for group audio calls."); return; }
        localStream =
            await getCallMedia("audio");

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
         * Tell every group member that a
         * group call has started.
         */

        send({
            type: "call-invite",
            groupId,
            callId
        });

        /*
         * Create an offer for every online
         * group member.
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

async function showCallUI(status, mode = "video") {
    currentPage = "call";
    const isVideo = mode === "video";
    const title = isVideo ? "VedChat Video Call" : "VedChat Audio Call";

    render(`
        <div class="call-screen ${isVideo ? "call-video-mode" : "call-audio-mode"}">
            <div class="call-top">
                <div class="call-top-title">
                    <span class="call-top-icon">${isVideo ? "📹" : "📞"}</span>
                    <div>
                        <strong>${title}</strong>
                        <div id="callStatus" class="call-status">${escapeHTML(status)}</div>
                    </div>
                </div>
                <span class="call-secure">🔒 Private</span>
            </div>

            ${isVideo ? `
                <div class="video-stage whatsapp-video-stage">
                    <div id="remoteVideos" class="remote-videos"></div>
                    <video id="localVideo" class="local-video" autoplay muted playsinline></video>
                    <div class="video-empty" id="videoEmpty">Waiting for video...</div>
                </div>
            ` : `
                <div class="audio-call-center">
                    <div class="audio-call-avatar">📞</div>
                    <h1>Audio call</h1>
                    <p id="audioCallStatus">${escapeHTML(status)}</p>
                </div>
            `}

            <div id="callMembers" class="call-members"></div>

            <div class="call-tip">${isVideo ? "🎙️ Mic + 📹 Camera" : "🎙️ Microphone only"}</div>

            <div class="call-controls">
                <button class="call-control" onclick="toggleMic()" title="Microphone">🎙️</button>
                ${isVideo ? `
                    <button class="call-control" onclick="toggleCamera()" title="Camera">📹</button>
                    <button class="call-control" onclick="switchCamera()" title="Switch camera">🔄</button>
                ` : ""}
                <button class="danger-btn end-call" onclick="endCall()">📵</button>
            </div>
        </div>
    `);

    updateCallMembers();
    const lv = document.getElementById("localVideo");
    if (lv && localStream) lv.srcObject = localStream;
}

function toggleMic() { if (!localStream) return; const t=localStream.getAudioTracks()[0]; if (t) t.enabled=!t.enabled; }
function toggleCamera() { if (!localStream) return; const t=localStream.getVideoTracks()[0]; if (t) t.enabled=!t.enabled; }
async function switchCamera() {
    if (!localStream) return;
    const track = localStream.getVideoTracks()[0];
    if (!track || !track.applyConstraints) return;
    const current = track.getSettings ? track.getSettings().facingMode : "user";
    try { await track.applyConstraints({facingMode: current === "environment" ? "user" : "environment"}); } catch(e) { console.warn("Camera switch unavailable", e); }
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

    document.querySelectorAll("audio[id^='audio-'], video[id^='video-'], #localVideo").forEach(el => el.remove());
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
            <div class="topbar-title-wrap">
                <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
                <div>
                <h1>Call History</h1>
                <small>
                    Recent calls
                </small>
                </div>
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
            <div class="topbar-title-wrap">
                <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
                <div>
                <h1>Profile</h1>
                <small>
                    Your VedChat account
                </small>
                </div>
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

                ${myAvatar ? `
                <button
                    class="danger-btn"
                    onclick="removeProfilePicture()"
                >
                    🗑️ Remove Profile Picture
                </button>` : ""}

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

        <section class="setting">
            <div class="setting-title">🔒 App Lock</div>
            <div class="setting-description">Lock VedChat with a local PIN when you leave the app.</div>
            <button class="primary-btn" onclick="setAppLock()">Enable / change PIN</button>
            ${localStorage.getItem("vedchat_app_lock") ? '<button class="secondary-btn" onclick="disableAppLock()">Disable App Lock</button>' : ''}
            ${localStorage.getItem("vedchat_auth_token") ? '<button class="secondary-btn" onclick="signOutAccount()">Sign out</button>' : ''}
        </section>
        ${bottomNav("profile")}
    `);
}

/* =====================================================
   NAVIGATION
===================================================== */

function bottomNav(active) {
    return `
        <nav class="bottom-nav">
            <button class="${active === "home" ? "active" : ""}" onclick="showHome()"><span>🏠</span><small>Home</small></button>
            <button class="${active === "chats" ? "active" : ""}" onclick="showChats()"><span>💬</span><small>Chats</small></button>
            <button class="${active === "vibes" ? "active" : ""}" onclick="showVibes()"><span>✨</span><small>Vibes</small></button>
            <button class="${active === "friends" || active === "groups" ? "active" : ""}" onclick="showFriends()"><span>👥</span><small>Social</small></button>
            <button class="${active === "profile" ? "active" : ""}" onclick="showProfile()"><span>👤</span><small>Me</small></button>
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
    const friend = getFriendByCode(code);
    return friend.name || "User";
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

ensureNotificationPermission();
const startupLocked = !!localStorage.getItem("vedchat_app_lock");
if (startupLocked) { appLockLocked = true; showAppLock(); }
else if (!myCode && !localStorage.getItem("vedchat_auth_token")) showAuthScreen();
else createAccountIfNeeded();

document.addEventListener("pointerdown", unlockSounds, { once: true, passive: true });
document.addEventListener("keydown", unlockSounds, { once: true, passive: true });

if (!startupLocked) showHome();

connectServer();
/* =====================================================
   SUPPORT VEDCHAT
===================================================== */
function showSupportVedChat(){
    currentPage="support";
    render(`
      <header class="topbar">
        <div class="topbar-title-wrap">
          <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
          <div><h1>Support VedChat</h1><small>Help keep the project awesome</small></div>
        </div>
      </header>
      <main>
        <section class="support-hero card">
          <div class="support-icon">💙</div>
          <div><h2>Thanks for using VedChat</h2><p>Explore help, send feedback, or learn what this build includes.</p></div>
        </section>
        <section class="card support-list">
          <button class="support-row" onclick="showSupportInfo('feedback')"><span>💡</span><div><strong>Send feedback</strong><small>Tell us what should be improved</small></div><b>›</b></button>
          <button class="support-row" onclick="showSupportInfo('features')"><span>✨</span><div><strong>What VedChat supports</strong><small>Chats, groups, calls, Vibes, voice and more</small></div><b>›</b></button>
          <button class="support-row" onclick="showSupportInfo('about')"><span>ℹ️</span><div><strong>About this build</strong><small>VedChat Android • V10</small></div><b>›</b></button>
        </section>
        <section class="card support-note"><strong>🛠️ Need help?</strong><p>If something looks broken, note the screen, what you tapped, and what happened. That makes fixes much faster.</p></section>
      </main>`);
}
function showSupportInfo(type){
    const data={
      feedback:['Send feedback','Write down the feature or bug you want changed.'],
      features:['VedChat features','Private chats, groups, voice messages, typing indicators, Vibes, voice/video calls, QR connect, profiles, friends, call history, app lock and Offline VedChat are included in the current UI.'],
      about:['About this build','VedChat Android V10 uses a bundled local UI, so the app screen itself does not depend on the Render webpage loading. Online messaging still needs the VedChat server.']
    }[type];
    const old=document.getElementById('supportModal'); if(old)old.remove();
    const el=document.createElement('div'); el.id='supportModal'; el.className='ui-modal-backdrop'; el.innerHTML=`<div class="ui-modal"><div class="ui-modal-icon">💙</div><h3>${escapeHTML(data[0])}</h3><p>${escapeHTML(data[1])}</p><button class="primary-btn" onclick="document.getElementById('supportModal')?.remove()">Got it</button></div>`; document.body.appendChild(el);
}

/* =====================================================
   ANDROID BLUETOOTH OFFLINE VEDCHAT
   Added without replacing the original V3 features.
===================================================== */
let bluetoothOfflineContact = null;
let bluetoothOfflineMessages = JSON.parse(localStorage.getItem("vedchat_bt_messages") || "[]");
function saveBluetoothOfflineMessages(){ localStorage.setItem("vedchat_bt_messages", JSON.stringify(bluetoothOfflineMessages)); }
function androidBluetoothAvailable(){ return !!window.AndroidBluetooth; }
function openBluetoothOffline(){
    currentPage = "bluetooth-offline";
    const app=document.getElementById("app"); if(!app)return;
    app.innerHTML=`
        <div class="app bluetooth-screen">
            <header class="topbar bluetooth-topbar">
                <button class="top-back" onclick="showHome()" aria-label="Back to home">←</button>
                <div class="bluetooth-title">
                    <div class="bluetooth-title-icon">📡</div>
                    <div><h1>Offline VedChat</h1><small id="btStatus">Ready for nearby chat</small></div>
                </div>
            </header>
            <main>
                <section class="bt-hero-card">
                    <div class="bt-hero-icon">📡</div>
                    <div><h2>Bluetooth Chat</h2><p>Message nearby phones without internet.</p></div>
                </section>
                <section class="card bt-control-card">
                    <div class="section-heading"><span>🔗</span><div><h2>Connect a phone</h2><p>Pair the phones in Android Bluetooth settings first.</p></div></div>
                    <button class="primary-btn" onclick="btFindDevices()">🔎 Find Paired Devices</button>
                    <button class="secondary-btn" onclick="btHost()">📡 Host This Phone</button>
                    <div class="bt-tip">💡 One phone can host while the other connects.</div>
                </section>
                <section class="card bt-chat-card">
                    <div class="section-heading"><span>💬</span><div><h2>Messages</h2><p>Your Bluetooth messages are saved on this phone.</p></div></div>
                    <div id="btMessages" class="bt-messages"></div>
                    <div class="bt-composer">
                        <input id="btInput" type="text" placeholder="Type a message..." autocomplete="off" maxlength="5000">
                        <button class="bt-send-btn" onclick="btSend()" aria-label="Send message">➤</button>
                    </div>
                    <div class="bt-enter-hint">Press <b>Enter</b> to send</div>
                </section>
            </main>
        </div>`;
    const input=document.getElementById("btInput");
    if(input){
        input.addEventListener("keydown",function(event){
            if(event.key === "Enter" && !event.shiftKey){
                event.preventDefault();
                btSend();
            }
        });
        setTimeout(function(){ input.focus(); },120);
    }
    btRender();
}

function btFindDevices(){
    if(!androidBluetoothAvailable()){ alert("Bluetooth Offline VedChat works in the Android app."); return; }
    AndroidBluetooth.requestBluetoothPermissions();
    setTimeout(()=>AndroidBluetooth.getPairedDevices(),400);
}

function btHost(){
    if(!androidBluetoothAvailable()){ alert("Open VedChat in the Android app to use Bluetooth."); return; }
    AndroidBluetooth.requestBluetoothPermissions();
    setTimeout(function(){ AndroidBluetooth.startHost(); },400);
}
window.onBluetoothHosting=function(){
    var e=document.getElementById("btStatus");
    if(e)e.textContent="🟡 Waiting for another phone…";
};

window.onBluetoothDevices=function(json){
    let list=[]; try{list=JSON.parse(json||"[]")}catch{}
    if(!list.length){alert("No paired devices found. Pair the phones in Android Bluetooth settings first.");return;}
    const choices=list.map((d,i)=>`${i+1}. ${d.name||"Bluetooth device"}`).join("\n");
    const n=Number(prompt("Choose a paired device:\n\n"+choices+"\n\nEnter number:"));
    if(!n||!list[n-1])return;
    bluetoothOfflineContact=list[n-1];
    AndroidBluetooth.connect(bluetoothOfflineContact.address, bluetoothOfflineContact.name||"Bluetooth device");
};
window.onBluetoothConnected=function(name){const e=document.getElementById("btStatus");if(e)e.textContent="🟢 Connected to "+name;};
window.onBluetoothDisconnected=function(){const e=document.getElementById("btStatus");if(e)e.textContent="🔴 Disconnected";};
window.onBluetoothMessage=function(raw){
    let m; try{m=JSON.parse(raw)}catch{return;}
    bluetoothOfflineMessages.push({from:m.from||"other",name:m.name||"Bluetooth friend",text:m.text||"",time:Date.now()});
    saveBluetoothOfflineMessages(); btRender();
};
function btSend(){
    const i=document.getElementById("btInput"), text=(i?.value||"").trim(); if(!text)return;
    if(!androidBluetoothAvailable()){alert("Open VedChat in the Android app to use Bluetooth.");return;}
    const packet={from:myCode||"ME",name:myName||"Me",text:text};
    AndroidBluetooth.sendMessage(JSON.stringify(packet));
    bluetoothOfflineMessages.push({from:myCode||"ME",name:myName||"Me",text,time:Date.now()}); saveBluetoothOfflineMessages(); i.value=""; btRender();
}
function btRender(){
    const a=document.getElementById("btMessages"); if(!a)return;
    const me=myCode||"ME";
    a.innerHTML=bluetoothOfflineMessages.slice(-100).map(m=>{
        const mine=m.from===me || m.from==="ME";
        return `<div class="bt-message ${mine?"mine":"theirs"}"><div class="bt-message-name">${escapeHTML(mine?"You":(m.name||"Bluetooth friend"))}</div><div class="bt-message-text">${escapeHTML(m.text||"")}</div><small>${formatTime(m.time)}</small></div>`;
    }).join("")||'<div class="bt-empty"><div>💬</div><strong>No messages yet</strong><span>Connect to a nearby phone and start chatting.</span></div>';
    a.scrollTop=a.scrollHeight;
}
