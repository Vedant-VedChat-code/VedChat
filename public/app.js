/*
==================================================
VEDCHAT
Public server + 10-character connection code
Real-time chat + WebRTC audio calling
==================================================
*/

const SERVER_URL =
    "wss://vedchat.onrender.com";

let socket = null;

let connectionState =
    "disconnected";

let connectionCode = "";

let peerName = "";

let currentPage =
    "home";

let currentChatName = "";

let callState =
    "idle";

let callTimer = null;

let callSeconds = 0;

let localStream = null;

let remoteStream = null;

let peerConnection = null;

let currentCallUser = "";

let reconnectTimer = null;


/*
==================================================
PROFILE
==================================================
*/

function getDisplayName() {
    return (
        localStorage.getItem(
            "displayName"
        ) ||
        "Guest"
    );
}

function getUsername() {
    return (
        localStorage.getItem(
            "username"
        ) ||
        ""
    );
}

function getStatus() {
    return (
        localStorage.getItem(
            "status"
        ) ||
        "Available"
    );
}

function escapeHTML(text) {
    const div =
        document.createElement(
            "div"
        );

    div.textContent =
        String(text ?? "");

    return div.innerHTML;
}


/*
==================================================
LOCAL CHAT STORAGE
==================================================
*/

function getChats() {
    try {
        return JSON.parse(
            localStorage.getItem(
                "vedchat_chats"
            ) || "[]"
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


/*
==================================================
START
==================================================
*/

function startApp() {
    applyTheme();
    connectServer();
    showHome();
}


/*
==================================================
WEBSOCKET
==================================================
*/

function connectServer() {
    if (
        socket &&
        (
            socket.readyState ===
                WebSocket.OPEN ||
            socket.readyState ===
                WebSocket.CONNECTING
        )
    ) {
        return;
    }

    try {
        socket =
            new WebSocket(
                SERVER_URL
            );
    } catch (error) {
        console.error(error);
        return;
    }

    socket.onopen = () => {
        connectionState =
            "server-connected";

        updateConnectionUI();
    };

    socket.onmessage =
        (event) => {
            try {
                const message =
                    JSON.parse(
                        event.data
                    );

                handleServerMessage(
                    message
                );
            } catch (error) {
                console.error(
                    "Server message error:",
                    error
                );
            }
        };

    socket.onclose = () => {
        connectionState =
            "disconnected";

        peerName = "";

        updateConnectionUI();

        if (
            reconnectTimer
        ) {
            clearTimeout(
                reconnectTimer
            );
        }

        reconnectTimer =
            setTimeout(
                connectServer,
                3000
            );
    };

    socket.onerror =
        (error) => {
            console.error(
                "WebSocket error:",
                error
            );
        };
}

function sendServer(data) {
    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        alert(
            "VedChat server is not connected yet."
        );

        return false;
    }

    socket.send(
        JSON.stringify(data)
    );

    return true;
}


/*
==================================================
SERVER MESSAGES
==================================================
*/

function handleServerMessage(
    message
) {
    if (
        message.type ===
        "server-ready"
    ) {
        return;
    }

    if (
        message.type ===
        "room-created"
    ) {
        connectionCode =
            message.code;

        connectionState =
            "connected";

        showConnectionCode();

        return;
    }

    if (
        message.type ===
        "room-joined"
    ) {
        connectionCode =
            message.code;

        connectionState =
            "connected";

        alert(
            "🟢 Connected to VedChat!"
        );

        showHome();

        return;
    }

    if (
        message.type ===
        "peer-joined"
    ) {
        peerName =
            message.name ||
            "User";

        connectionState =
            "connected";

        alert(
            `${peerName} joined your VedChat.`
        );

        updateConnectionUI();

        return;
    }

    if (
        message.type ===
        "peer-left"
    ) {
        peerName = "";

        connectionState =
            "connected";

        if (
            callState !==
            "idle"
        ) {
            endCall(
                false
            );
        }

        alert(
            "The other user disconnected."
        );

        return;
    }

    if (
        message.type ===
        "chat"
    ) {
        receiveChat(
            message
        );

        return;
    }

    if (
        message.type ===
        "call-offer"
    ) {
        handleCallOffer(
            message
        );

        return;
    }

    if (
        message.type ===
        "call-answer"
    ) {
        handleCallAnswer(
            message
        );

        return;
    }

    if (
        message.type ===
        "ice-candidate"
    ) {
        handleIceCandidate(
            message
        );

        return;
    }

    if (
        message.type ===
        "call-decline"
    ) {
        handleCallDecline(
            message
        );

        return;
    }

    if (
        message.type ===
        "call-end"
    ) {
        handleCallEnd(
            message
        );

        return;
    }

    if (
        message.type ===
        "error"
    ) {
        alert(
            "VedChat: " +
            message.message
        );
    }
}


/*
==================================================
CONNECTION
==================================================
*/

function showConnection() {
    currentPage =
        "connection";

    render(`
        <header>
            <div>
                <h1>🔗 Connect</h1>
                <small>
                    Connect two VedChat users
                </small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <h2>One Connection Code</h2>

            <p>
                One person creates a code.
                The other person enters the same
                code.
            </p>

            <button
                class="primary-btn"
                onclick="createRoom()"
            >
                ✨ Create Connection Code
            </button>

            <button
                class="primary-btn"
                onclick="joinRoomScreen()"
            >
                🔢 Enter Connection Code
            </button>

            ${
                connectionState ===
                "connected"
                    ? `
                    <div class="connected-card">
                        🟢 Connected
                        <br>
                        <small>
                            ${
                                escapeHTML(
                                    peerName ||
                                    "User"
                                )
                            }
                        </small>
                    </div>

                    <button
                        class="danger-btn"
                        onclick="disconnect()"
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

function createRoom() {
    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        alert(
            "Connecting to VedChat server. Please try again in a moment."
        );

        connectServer();

        return;
    }

    sendServer({
        type: "create-room",
        name: getDisplayName()
    });
}

function showConnectionCode() {
    render(`
        <header>
            <div>
                <h1>🎉 Your Code</h1>
                <small>
                    Give this code to the other person
                </small>
            </div>
        </header>

        <main>

            <div class="code-card">

                <div class="code-label">
                    CONNECTION CODE
                </div>

                <div class="connection-code">
                    ${escapeHTML(
                        connectionCode
                    )}
                </div>

                <button
                    class="secondary-btn"
                    onclick="copyConnectionCode()"
                >
                    📋 Copy Code
                </button>

            </div>

            <p>
                On the other phone, enter:
            </p>

            <strong>
                ${escapeHTML(
                    connectionCode
                )}
            </strong>

            <p>
                Waiting for the other user...
            </p>

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>
    `);
}

function copyConnectionCode() {
    navigator.clipboard
        .writeText(connectionCode)
        .then(() => {
            alert("Code copied!");
        })
        .catch(() => {
            alert(
                "Code: " +
                connectionCode
            );
        });
}

function joinRoomScreen() {
    render(`
        <header>
            <div>
                <h1>🔢 Join</h1>
                <small>
                    Enter the connection code
                </small>
            </div>
        </header>

        <main>

            <input
                class="code-input"
                id="joinCode"
                maxlength="10"
                placeholder="10-character code"
                autocomplete="off"
            >

            <button
                class="primary-btn"
                onclick="joinRoom()"
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

function joinRoom() {
    const input =
        document.getElementById(
            "joinCode"
        );

    if (!input) {
        return;
    }

    const code =
        input.value
            .trim()
            .toUpperCase();

    if (code.length !== 10) {
        alert(
            "The connection code must be 10 characters."
        );

        return;
    }

    if (
        !sendServer({
            type: "join-room",
            code: code,
            name: getDisplayName()
        })
    ) {
        return;
    }
}

function disconnect() {
    if (
        callState !== "idle"
    ) {
        endCall(true);
    }

    if (socket) {
        socket.close();
    }

    connectionState =
        "disconnected";

    connectionCode = "";

    peerName = "";

    setTimeout(
        connectServer,
        500
    );

    showHome();
}


/*
==================================================
CHAT
==================================================
*/

function showChats() {
    currentPage =
        "chats";

    render(`
        <header>
            <div>
                <h1>💬 Chats</h1>
                <small>
                    Real-time VedChat
                </small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <input
                class="search"
                id="chatSearch"
                placeholder="🔍 Search chats"
                oninput="filterChats()"
            >

            <button
                class="primary-btn"
                onclick="showNewChat()"
            >
                ➕ New Chat
            </button>

            <div id="chatList"></div>

        </main>

        ${bottomNav("chats")}
    `);

    renderChatList();
}

function showNewChat() {
    render(`
        <header>
            <div>
                <h1>New Chat</h1>
            </div>
        </header>

        <main>

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
            "Enter a name."
        );

        return;
    }

    const chats =
        getChats();

    if (
        !chats.some(
            chat =>
                chat.name === name
        )
    ) {
        chats.push({
            name: name,
            messages: []
        });

        saveChats(chats);
    }

    showChats();
}

function renderChatList(
    search = ""
) {
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
        chats.filter(
            chat =>
                String(
                    chat.name
                )
                    .toLowerCase()
                    .includes(
                        search.toLowerCase()
                    )
        );

    if (
        filtered.length === 0
    ) {
        list.innerHTML = `
            <div class="empty">
                No chats yet.
            </div>
        `;

        return;
    }

    list.innerHTML = "";

    filtered.forEach(
        chat => {
            const index =
                chats.indexOf(
                    chat
                );

            const last =
                chat.messages &&
                chat.messages.length
                    ? chat.messages[
                        chat.messages.length -
                        1
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
                        chat.name
                            .charAt(0)
                            .toUpperCase()
                    )}
                </div>

                <div
                    class="chat-info"
                    onclick="openChat(${index})"
                >
                    <strong>
                        ${escapeHTML(
                            chat.name
                        )}
                    </strong>

                    <small>
                        ${escapeHTML(
                            last
                        )}
                    </small>
                </div>
            `;

            list.appendChild(
                item
            );
        }
    );
}

function filterChats() {
    const input =
        document.getElementById(
            "chatSearch"
        );

    if (input) {
        renderChatList(
            input.value
        );
    }
}

function openChat(index) {
    const chats =
        getChats();

    const chat =
        chats[index];

    if (!chat) {
        return;
    }

    currentChatName =
        chat.name;

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
                        connectionState ===
                        "connected"
                            ? "🟢 Connected"
                            : "Not connected"
                    }
                </small>
            </div>
        </header>

        <main>

            <div
                class="message-area"
                id="messageArea"
            ></div>

            <div class="message-box">

                <input
                    id="messageInput"
                    class="message-input"
                    placeholder="Type a message..."
                    autocomplete="off"
                >

                <button
                    class="send-btn"
                    onclick="sendChat()"
                >
                    ➤
                </button>

            </div>

            ${
                connectionState ===
                "connected"
                    ? `
                    <button
                        class="call-btn"
                        onclick="startCall()"
                    >
                        📞 Call
                    </button>
                    `
                    : `
                    <p class="empty">
                        Connect to another user
                        before calling.
                    </p>
                    `
            }

            <button
                class="secondary-btn"
                onclick="showChats()"
            >
                ← Back
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
            event => {
                if (
                    event.key ===
                    "Enter"
                ) {
                    sendChat();
                }
            }
        );
    }

    displayMessages();
}

function sendChat() {
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

    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "Connect to another user first."
        );

        return;
    }

    sendServer({
        type: "chat",
        text: text
    });

    saveLocalMessage(
        getDisplayName(),
        text,
        true
    );

    input.value = "";

    displayMessages();

    input.focus();
}

function saveLocalMessage(
    sender,
    text,
    local
) {
    const chats =
        getChats();

    let index =
        chats.findIndex(
            chat =>
                chat.name ===
                currentChatName
        );

    if (index === -1) {
        chats.push({
            name:
                currentChatName ||
                sender,
            messages: []
        });

        index =
            chats.length - 1;
    }

    chats[index].messages.push({
        sender: sender,
        text: text,
        time:
            new Date().toISOString(),
        local: local
    });

    saveChats(chats);
}

function receiveChat(message) {
    peerName =
        message.sender ||
        peerName;

    const chats =
        getChats();

    let index =
        chats.findIndex(
            chat =>
                chat.name ===
                message.sender
        );

    if (index === -1) {
        chats.push({
            name:
                message.sender ||
                "User",
            messages: []
        });

        index =
            chats.length - 1;
    }

    chats[index].messages.push({
        sender:
            message.sender,
        text:
            message.text,
        time:
            message.time ||
            new Date().toISOString(),
        remote: true
    });

    saveChats(chats);

    if (
        currentChatName ===
        message.sender &&
        currentPage ===
        "chat"
    ) {
        displayMessages();
    }
}

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
        chats.find(
            item =>
                item.name ===
                currentChatName
        );

    if (!chat) {
        return;
    }

    area.innerHTML = "";

    chat.messages.forEach(
        message => {
            const bubble =
                document.createElement(
                    "div"
                );

            bubble.className =
                message.sender ===
                getDisplayName()
                    ? "message mine"
                    : "message theirs";

            const time =
                new Date(
                    message.time
                ).toLocaleTimeString(
                    [],
                    {
                        hour:
                            "2-digit",
                        minute:
                            "2-digit"
                    }
                );

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

                <small>
                    ${time}
                </small>
            `;

            area.appendChild(
                bubble
            );
        }
    );

    area.scrollTop =
        area.scrollHeight;
}


/*
==================================================
REAL WEBRTC AUDIO CALLING
==================================================
*/

async function createPeerConnection() {
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
        event => {
            if (
                event.candidate
            ) {
                sendServer({
                    type:
                        "ice-candidate",
                    candidate:
                        event.candidate
                });
            }
        };

    peerConnection.ontrack =
        event => {
            if (
                !remoteStream
            ) {
                remoteStream =
                    new MediaStream();
            }

            remoteStream.addTrack(
                event.track
            );

            playRemoteAudio();
        };

    peerConnection.onconnectionstatechange =
        () => {
            if (
                !peerConnection
            ) {
                return;
            }

            const state =
                peerConnection
                    .connectionState;

            if (
                state ===
                    "connected"
            ) {
                showActiveCall(
                    currentCallUser
                );
            }

            if (
                state ===
                    "failed"
            ) {
                alert(
                    "The call connection failed."
                );

                endCall(
                    false
                );
            }
        };
}

async function getMicrophone() {
    try {
        localStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: true,
                    video: false
                }
            );

        return true;
    } catch (error) {
        console.error(
            "Microphone error:",
            error
        );

        alert(
            "Microphone permission was denied or unavailable. Please allow microphone access for VedChat."
        );

        return false;
    }
}

async function startCall() {
    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "Connect to another user first."
        );

        return;
    }

    if (
        callState !==
        "idle"
    ) {
        alert(
            "A call is already active."
        );

        return;
    }

    if (
        !peerName
    ) {
        alert(
            "The other user is not connected."
        );

        return;
    }

    currentCallUser =
        peerName;

    callState =
        "calling";

    showCallingScreen();

    const mic =
        await getMicrophone();

    if (!mic) {
        callState =
            "idle";

        showHome();

        return;
    }

    await createPeerConnection();

    localStream
        .getTracks()
        .forEach(
            track => {
                peerConnection.addTrack(
                    track,
                    localStream
                );
            }
        );

    try {
        const offer =
            await peerConnection.createOffer();

        await peerConnection.setLocalDescription(
            offer
        );

        sendServer({
            type:
                "call-offer",
            offer:
                peerConnection
                    .localDescription
        });
    } catch (error) {
        console.error(
            error
        );

        alert(
            "Could not start the call."
        );

        endCall(
            false
        );
    }
}

async function handleCallOffer(
    message
) {
    if (
        callState !==
        "idle"
    ) {
        sendServer({
            type:
                "call-decline",
            reason:
                "busy"
        });

        return;
    }

    currentCallUser =
        message.sender ||
        "User";

    window.pendingCallOffer =
        message.offer;

    callState =
        "incoming";

    showIncomingCall();
}

async function answerCall() {
    if (
        callState !==
        "incoming"
    ) {
        return;
    }

    const mic =
        await getMicrophone();

    if (!mic) {
        callState =
            "idle";

        return;
    }

    await createPeerConnection();

    localStream
        .getTracks()
        .forEach(
            track => {
                peerConnection.addTrack(
                    track,
                    localStream
                );
            }
        );

    try {
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                window.pendingCallOffer
            )
        );

        const answer =
            await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(
            answer
        );

        sendServer({
            type:
                "call-answer",
            answer:
                peerConnection
                    .localDescription
        });

        callState =
            "connected";

        showActiveCall(
            currentCallUser
        );

        startCallTimer();
    } catch (error) {
        console.error(
            error
        );

        alert(
            "Could not answer the call."
        );

        endCall(
            false
        );
    }
}

async function handleCallAnswer(
    message
) {
    if (
        callState !==
        "calling"
    ) {
        return;
    }

    try {
        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                message.answer
            )
        );

        callState =
            "connected";

        showActiveCall(
            currentCallUser
        );

        startCallTimer();
    } catch (error) {
        console.error(
            error
        );

        alert(
            "Could not connect the call."
        );

        endCall(
            false
        );
    }
}

async function handleIceCandidate(
    message
) {
    if (
        !peerConnection ||
        !message.candidate
    ) {
        return;
    }

    try {
        await peerConnection.addIceCandidate(
            new RTCIceCandidate(
                message.candidate
            )
        );
    } catch (error) {
        console.error(
            "ICE error:",
            error
        );
    }
}

function declineCall() {
    sendServer({
        type:
            "call-decline"
    });

    cleanupCall();

    showHome();
}

function handleCallDecline() {
    alert(
        "The other user declined the call."
    );

    cleanupCall();

    showHome();
}

function handleCallEnd() {
    alert(
        "The other user ended the call."
    );

    cleanupCall();

    showHome();
}

function endCall(
    sendSignal = true
) {
    if (
        sendSignal
    ) {
        sendServer({
            type:
                "call-end"
        });
    }

    cleanupCall();

    showHome();
}

function cleanupCall() {
    stopCallTimer();

    if (
        localStream
    ) {
        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );
    }

    if (
        peerConnection
    ) {
        try {
            peerConnection.close();
        } catch (error) {}
    }

    localStream =
        null;

    remoteStream =
        null;

    peerConnection =
        null;

    window.pendingCallOffer =
        null;

    callState =
        "idle";

    currentCallUser =
        "";
}

function playRemoteAudio() {
    if (
        !remoteStream
    ) {
        return;
    }

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

        document.body.appendChild(
            audio
        );
    }

    audio.srcObject =
        remoteStream;

    audio.play().catch(
        error => {
            console.log(
                "Audio playback waiting for user:",
                error
            );
        }
    );
}


/*
==================================================
CALL UI
==================================================
*/

function showCallingScreen() {
    render(`
        <header>
            <div>
                <h1>📞 Calling</h1>
                <small>
                    VedChat audio call
                </small>
            </div>
        </header>

        <main class="call-screen">

            <div class="big-avatar">
                ${escapeHTML(
                    currentCallUser
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    currentCallUser
                )}
            </h2>

            <p>
                📞 Calling...
            </p>

            <button
                class="danger-btn"
                onclick="endCall(true)"
            >
                📵 Cancel
            </button>

        </main>
    `);
}

function showIncomingCall() {
    render(`
        <header>
            <div>
                <h1>📞 Incoming Call</h1>
                <small>
                    VedChat
                </small>
            </div>
        </header>

        <main class="call-screen">

            <div class="big-avatar">
                ${escapeHTML(
                    currentCallUser
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    currentCallUser
                )}
            </h2>

            <p>
                📞 ${escapeHTML(
                    currentCallUser
                )} is calling you
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

    playCallRingtone();
}

function showActiveCall(user) {
    stopCallRingtone();

    render(`
        <header>
            <div>
                <h1>📞 Call</h1>
                <small>
                    VedChat audio
                </small>
            </div>
        </header>

        <main class="call-screen">

            <div class="big-avatar">
                ${escapeHTML(
                    user
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(user)}
            </h2>

            <p>
                🟢 Connected
            </p>

            <div
                id="callTimer"
                class="call-timer"
            >
                00:00
            </div>

            <button
                class="secondary-btn"
                onclick="toggleMute()"
                id="muteButton"
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

    playRemoteAudio();
}

let ringtoneAudio =
    null;

function playCallRingtone() {
    stopCallRingtone();

    try {
        const AudioContext =
            window.AudioContext ||
            window.webkitAudioContext;

        if (!AudioContext) {
            return;
        }

        ringtoneAudio =
            new AudioContext();

        const oscillator =
            ringtoneAudio
                .createOscillator();

        const gain =
            ringtoneAudio
                .createGain();

        oscillator.frequency.value =
            700;

        gain.gain.value =
            0.08;

        oscillator.connect(
            gain
        );

        gain.connect(
            ringtoneAudio
                .destination
        );

        oscillator.start();

        window.ringtoneOscillator =
            oscillator;

        ringtoneAudio.resume();
    } catch (error) {
        console.log(
            "Ringtone unavailable."
        );
    }
}

function stopCallRingtone() {
    try {
        if (
            window.ringtoneOscillator
        ) {
            window.ringtoneOscillator.stop();
        }
    } catch (error) {}

    try {
        if (
            ringtoneAudio
        ) {
            ringtoneAudio.close();
        }
    } catch (error) {}

    window.ringtoneOscillator =
        null;

    ringtoneAudio =
        null;
}

function toggleMute() {
    if (!localStream) {
        return;
    }

    const track =
        localStream.getAudioTracks()[0];

    if (!track) {
        return;
    }

    track.enabled =
        !track.enabled;

    const button =
        document.getElementById(
            "muteButton"
        );

    if (button) {
        button.textContent =
            track.enabled
                ? "🎤 Mute"
                : "🔇 Unmute";
    }
}

function startCallTimer() {
    stopCallTimer();

    callSeconds =
        0;

    callTimer =
        setInterval(() => {
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
                    .padStart(
                        2,
                        "0"
                    );

            const seconds =
                (
                    callSeconds % 60
                )
                    .toString()
                    .padStart(
                        2,
                        "0"
                    );

            timer.textContent =
                `${minutes}:${seconds}`;
        }, 1000);
}

function stopCallTimer() {
    if (
        callTimer
    ) {
        clearInterval(
            callTimer
        );

        callTimer =
            null;
    }
}


/*
==================================================
PROFILE
==================================================
*/

function showProfile() {
    render(`
        <header>
            <div>
                <h1>👤 Profile</h1>
                <small>
                    Your VedChat profile
                </small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <div class="profile-card">

                <div class="big-avatar">
                    ${escapeHTML(
                        getDisplayName()
                            .charAt(0)
                            .toUpperCase()
                    )}
                </div>

                <h2>
                    ${escapeHTML(
                        getDisplayName()
                    )}
                </h2>

                <p>
                    @${escapeHTML(
                        getUsername() ||
                        "username"
                    )}
                </p>

                <p>
                    ${escapeHTML(
                        getStatus()
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
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>

        ${bottomNav("profile")}
    `);
}

function editProfile() {
    const username =
        prompt(
            "Username:",
            getUsername()
        );

    if (
        username === null ||
        !username.trim()
    ) {
        return;
    }

    const displayName =
        prompt(
            "Display name:",
            getDisplayName()
        );

    if (
        displayName === null ||
        !displayName.trim()
    ) {
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
        status
            ? status.trim()
            : ""
    );

    showProfile();
}


/*
==================================================
SETTINGS
==================================================
*/

function showSettings() {
    const dark =
        localStorage.getItem(
            "darkMode"
        ) === "true";

    render(`
        <header>
            <div>
                <h1>⚙️ Settings</h1>
                <small>
                    VedChat settings
                </small>
            </div>
        </header>

        <main>

            <button
                class="secondary-btn"
                onclick="toggleDarkMode()"
            >
                ${
                    dark
                        ? "☀️ Light Mode"
                        : "🌙 Dark Mode"
                }
            </button>

            <div class="setting">
                <strong>
                    🌐 Server
                </strong>

                <p>
                    vedchat.onrender.com
                </p>
            </div>

            <div class="setting">
                <strong>
                    🔗 Connection
                </strong>

                <p>
                    10-character room codes
                </p>
            </div>

            <div class="setting">
                <strong>
                    📞 Calling
                </strong>

                <p>
                    WebRTC audio calling
                </p>
            </div>

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

function toggleDarkMode() {
    const current =
        localStorage.getItem(
            "darkMode"
        ) === "true";

    localStorage.setItem(
        "darkMode",
        String(!current)
    );

    applyTheme();

    showSettings();
}

function applyTheme() {
    const dark =
        localStorage.getItem(
            "darkMode"
        ) === "true";

    document.body.classList.toggle(
        "dark",
        dark
    );
}


/*
==================================================
HOME
==================================================
*/

function showHome() {
    currentPage =
        "home";

    render(`
        <header>
            <div>
                <h1>VedChat</h1>
                <small>
                    Private real-time chat
                </small>
            </div>

            ${connectionBadge()}
        </header>

        <main>

            <h2>
                Welcome 👋
            </h2>

            <p>
                Hello,
                <strong>
                    ${escapeHTML(
                        getDisplayName()
                    )}
                </strong>
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

                <small>
                    Local chats
                </small>
            </div>

        </main>

        ${bottomNav("home")}
    `);
}

function connectionBadge() {
    const connected =
        connectionState ===
        "connected";

    return `
        <span class="${
            connected
                ? "online"
                : "offline"
        }">
            ${
                connected
                    ? "🟢 CONNECTED"
                    : "🔴 OFFLINE"
            }
        </span>
    `;
}

function updateConnectionUI() {
    if (
        currentPage ===
        "home"
    ) {
        showHome();
    }
}


/*
==================================================
BOTTOM NAV
==================================================
*/

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
                    active === "profile"
                        ? "active"
                        : ""
                }"
                onclick="showProfile()"
            >
                👤
                <span>Profile</span>
            </button>

            <button
                class="${
                    active === "settings"
                        ? "active"
                        : ""
                }"
                onclick="showSettings()"
            >
                ⚙️
                <span>Settings</span>
            </button>

        </nav>
    `;
}


/*
==================================================
RENDER
==================================================
*/

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


/*
==================================================
START
==================================================
*/

startApp();