/* =====================================================
   VEDCHAT CLIENT
===================================================== */

let ws = null;

let connectionState = "offline";
let connectionCode = "";
let currentPage = "home";

let peerName = "";

let peerConnection = null;
let localStream = null;

let callState = "idle";
let currentCallId = null;
let incomingCaller = "";

let pendingOffer = null;
let pendingIceCandidates = [];

let callTimer = null;
let callSeconds = 0;

/* =====================================================
   STORAGE
===================================================== */

function getName() {
    return (
        localStorage.getItem(
            "vedchat_name"
        ) || "Guest"
    );
}

function setName(name) {
    localStorage.setItem(
        "vedchat_name",
        name
    );
}

function getSavedCode() {
    return (
        localStorage.getItem(
            "vedchat_code"
        ) || ""
    );
}

function setSavedCode(code) {
    localStorage.setItem(
        "vedchat_code",
        code
    );
}

/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHTML(text) {
    const div =
        document.createElement("div");

    div.textContent = String(text);

    return div.innerHTML;
}

/* =====================================================
   WEBSOCKET URL
===================================================== */

function getWebSocketURL() {
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
   CONNECT SERVER
===================================================== */

function connectToServer() {
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

    updateConnectionIndicator();

    try {
        ws = new WebSocket(
            getWebSocketURL()
        );
    } catch (error) {
        console.error(error);

        connectionState =
            "offline";

        updateConnectionIndicator();

        return;
    }

    ws.onopen = () => {
        connectionState =
            "connected";

        updateConnectionIndicator();

        /*
         * Register this device.
         *
         * If there is a saved code,
         * reuse it.
         *
         * Otherwise the server
         * creates one.
         */
        sendRaw({
            type: "register",
            name: getName(),
            code: getSavedCode()
        });
    };

    ws.onclose = () => {
        connectionState =
            "offline";

        updateConnectionIndicator();

        setTimeout(
            connectToServer,
            3000
        );
    };

    ws.onerror = (error) => {
        console.error(
            "WebSocket error:",
            error
        );

        connectionState =
            "offline";

        updateConnectionIndicator();
    };

    ws.onmessage = (event) => {
        let message;

        try {
            message =
                JSON.parse(
                    event.data
                );
        } catch {
            return;
        }

        handleServerMessage(
            message
        );
    };
}

/* =====================================================
   SEND
===================================================== */

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
    if (
        sendRaw(data)
    ) {
        return true;
    }

    alert(
        "VedChat is not connected to the server."
    );

    return false;
}

/* =====================================================
   SERVER EVENTS
===================================================== */

function handleServerMessage(message) {
    if (
        message.type ===
        "server-ready"
    ) {
        return;
    }

    /* ================================================
       REGISTERED
    ================================================ */

    if (
        message.type ===
        "registered"
    ) {
        connectionCode =
            message.code;

        setSavedCode(
            message.code
        );

        updateConnectionIndicator();

        return;
    }

    /* ================================================
       CONNECTED TO SOMEONE
    ================================================ */

    if (
        message.type ===
        "connected"
    ) {
        connectionCode =
            message.code;

        setSavedCode(
            message.code
        );

        peerName =
            message.name ||
            "User";

        alert(
            "🟢 Connected to VedChat!"
        );

        showHome();

        return;
    }

    /* ================================================
       PEER JOINED
    ================================================ */

    if (
        message.type ===
        "peer-joined"
    ) {
        peerName =
            message.name ||
            "User";

        showToast(
            `${peerName} joined VedChat`
        );

        return;
    }

    /* ================================================
       PEER LEFT
    ================================================ */

    if (
        message.type ===
        "peer-left"
    ) {
        peerName = "";

        showToast(
            "The other user disconnected."
        );

        if (
            callState !==
            "idle"
        ) {
            cleanupCall();
        }

        return;
    }

    /* ================================================
       CHAT
    ================================================ */

    if (
        message.type ===
        "chat"
    ) {
        receiveChat(
            message
        );

        return;
    }

    /* ================================================
       CALLING
    ================================================ */

    if (
        [
            "call",
            "offer",
            "answer",
            "ice-candidate",
            "call-answer",
            "call-decline",
            "call-end"
        ].includes(
            message.type
        )
    ) {
        handleCallSignal(
            message
        );

        return;
    }

    /* ================================================
       PROFILE
    ================================================ */

    if (
        message.type ===
        "profile"
    ) {
        connectionCode =
            message.code;

        setSavedCode(
            message.code
        );

        return;
    }

    /* ================================================
       ERROR
    ================================================ */

    if (
        message.type ===
        "error"
    ) {
        alert(
            message.message
        );
    }
}

/* =====================================================
   STATUS
===================================================== */

function updateConnectionIndicator() {
    const elements =
        document.querySelectorAll(
            ".connection-status"
        );

    elements.forEach(
        element => {
            element.textContent =
                connectionState;

            element.className =
                "connection-status " +
                (
                    connectionState ===
                    "connected"
                        ? "online"
                        : connectionState ===
                          "connecting"
                        ? "connecting"
                        : "offline"
                );
        }
    );
}

/* =====================================================
   CONNECTION PAGE
===================================================== */

function showConnection() {
    currentPage =
        "connection";

    render(`
        <header>
            <div>
                <h1>🔗 Connect</h1>
                <small>VedChat connection</small>
            </div>
        </header>

        <main>

            <div class="status-card">
                <div>Server status</div>

                <strong class="connection-status">
                    ${escapeHTML(
                        connectionState
                    )}
                </strong>
            </div>

            <section class="card">
                <h2>Your connection</h2>

                <p class="muted">
                    Your permanent 10-character
                    VedChat code:
                </p>

                <div class="big-code">
                    ${
                        connectionCode ||
                        "Connecting..."
                    }
                </div>

                <div id="qrcode"></div>

                <button
                    class="primary-btn"
                    onclick="copyConnectionCode()"
                >
                    📋 Copy My Code
                </button>
            </section>

            <section class="card">
                <h2>Connect to a person</h2>

                <input
                    id="joinCode"
                    maxlength="10"
                    placeholder="Enter 10-character code"
                    autocomplete="off"
                    style="text-transform:uppercase"
                >

                <button
                    class="primary-btn"
                    onclick="connectUsingCode()"
                >
                    🚀 Connect
                </button>
            </section>

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>

        ${bottomNav("home")}
    `);

    createQR();
}

/* =====================================================
   QR
===================================================== */

function createQR() {
    const container =
        document.getElementById(
            "qrcode"
        );

    if (
        !container ||
        !connectionCode
    ) {
        return;
    }

    container.innerHTML = "";

    if (
        typeof QRCode !==
        "undefined"
    ) {
        try {
            new QRCode(
                container,
                {
                    text:
                        connectionCode,
                    width: 210,
                    height: 210
                }
            );
        } catch (error) {
            console.error(
                "QR error:",
                error
            );
        }
    }
}

/* =====================================================
   COPY CODE
===================================================== */

async function copyConnectionCode() {
    if (!connectionCode) {
        return;
    }

    try {
        await navigator.clipboard.writeText(
            connectionCode
        );

        showToast(
            "Connection code copied!"
        );
    } catch {
        alert(
            "Your code is:\n\n" +
            connectionCode
        );
    }
}

/* =====================================================
   CONNECT USING CODE
===================================================== */

function connectUsingCode() {
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
            "The connection code must be exactly 10 characters."
        );

        return;
    }

    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "Wait for the server connection."
        );

        return;
    }

    send({
        type: "connect",
        code,
        name: getName()
    });
}

/* =====================================================
   CHAT STORAGE
===================================================== */

function getMessages() {
    try {
        return JSON.parse(
            localStorage.getItem(
                "vedchat_messages"
            ) || "[]"
        );
    } catch {
        return [];
    }
}

function saveMessages(messages) {
    localStorage.setItem(
        "vedchat_messages",
        JSON.stringify(
            messages.slice(-300)
        )
    );
}

function saveMessage(
    sender,
    text,
    time,
    own
) {
    const messages =
        getMessages();

    messages.push({
        sender,
        text,
        time,
        own: Boolean(own)
    });

    saveMessages(
        messages
    );
}

/* =====================================================
   RECEIVE CHAT
===================================================== */

function receiveChat(message) {
    saveMessage(
        message.sender ||
            "User",
        message.text,
        message.time ||
            new Date().toISOString(),
        false
    );

    if (
        currentPage ===
        "chat"
    ) {
        displayMessages();
    } else {
        showToast(
            `${message.sender}: ${message.text}`
        );
    }
}

/* =====================================================
   CHATS PAGE
===================================================== */

function showChats() {
    currentPage =
        "chats";

    const messages =
        getMessages();

    render(`
        <header>
            <div>
                <h1>💬 Chats</h1>
                <small>Real-time messaging</small>
            </div>
        </header>

        <main>

            <section class="chat-preview"
                onclick="openMainChat()"
            >
                <div class="avatar">
                    ${
                        escapeHTML(
                            (
                                peerName ||
                                "V"
                            )
                                .charAt(0)
                                .toUpperCase()
                        )
                    }
                </div>

                <div class="chat-preview-info">
                    <strong>
                        ${
                            escapeHTML(
                                peerName ||
                                "VedChat connection"
                            )
                        }
                    </strong>

                    <span>
                        ${
                            messages.length
                                ? escapeHTML(
                                    messages[
                                        messages.length -
                                            1
                                    ].text
                                )
                                : "No messages yet"
                        }
                    </span>
                </div>

                <div>›</div>
            </section>

            <button
                class="primary-btn"
                onclick="openMainChat()"
            >
                💬 Open Chat
            </button>

        </main>

        ${bottomNav("chats")}
    `);
}

/* =====================================================
   MAIN CHAT
===================================================== */

function openMainChat() {
    currentPage =
        "chat";

    render(`
        <header class="chat-header">
            <button
                class="header-back"
                onclick="showChats()"
            >
                ←
            </button>

            <div class="header-person">
                <div class="mini-avatar">
                    ${
                        escapeHTML(
                            (
                                peerName ||
                                "V"
                            )
                                .charAt(0)
                                .toUpperCase()
                        )
                    }
                </div>

                <div>
                    <h1>
                        ${
                            escapeHTML(
                                peerName ||
                                "VedChat"
                            )
                        }
                    </h1>

                    <small>
                        ${
                            connectionState ===
                            "connected"
                                ? "Connected"
                                : "Waiting for connection"
                        }
                    </small>
                </div>
            </div>

            <button
                class="header-call"
                onclick="startCall()"
            >
                📞
            </button>
        </header>

        <main class="chat-main">

            <div
                id="messageArea"
                class="message-area"
            ></div>

            <div class="message-input-area">

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
                    event.preventDefault();
                    sendChat();
                }
            }
        );

        input.focus();
    }

    displayMessages();
}

/* =====================================================
   SEND CHAT
===================================================== */

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
            "VedChat is not connected to the server."
        );

        return;
    }

    const time =
        new Date().toISOString();

    saveMessage(
        getName(),
        text,
        time,
        true
    );

    const success =
        send({
            type: "chat",
            text
        });

    if (success) {
        input.value = "";
        displayMessages();
    }
}

/* =====================================================
   DISPLAY MESSAGES
===================================================== */

function displayMessages() {
    const area =
        document.getElementById(
            "messageArea"
        );

    if (!area) {
        return;
    }

    const messages =
        getMessages();

    area.innerHTML = "";

    if (!messages.length) {
        area.innerHTML = `
            <div class="empty">
                <div class="empty-icon">💬</div>
                <p>No messages yet.</p>
                <small>
                    Send a message to start chatting.
                </small>
            </div>
        `;

        return;
    }

    messages.forEach(
        message => {
            const row =
                document.createElement(
                    "div"
                );

            row.className =
                "message-row " +
                (
                    message.own
                        ? "message-right"
                        : "message-left"
                );

            const bubble =
                document.createElement(
                    "div"
                );

            bubble.className =
                "message-bubble";

            const sender =
                document.createElement(
                    "div"
                );

            sender.className =
                "message-sender";

            sender.textContent =
                message.sender;

            const text =
                document.createElement(
                    "div"
                );

            text.className =
                "message-text";

            text.textContent =
                message.text;

            const time =
                document.createElement(
                    "div"
                );

            time.className =
                "message-time";

            time.textContent =
                new Date(
                    message.time
                ).toLocaleTimeString(
                    [],
                    {
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                );

            bubble.appendChild(
                sender
            );

            bubble.appendChild(
                text
            );

            bubble.appendChild(
                time
            );

            row.appendChild(
                bubble
            );

            area.appendChild(
                row
            );
        }
    );

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   WEBRTC
===================================================== */

function createPeerConnection() {
    const pc =
        new RTCPeerConnection({
            iceServers: [
                {
                    urls:
                        "stun:stun.l.google.com:19302"
                }
            ]
        });

    pc.onicecandidate =
        event => {
            if (
                event.candidate &&
                currentCallId
            ) {
                send({
                    type:
                        "ice-candidate",
                    callId:
                        currentCallId,
                    candidate:
                        event.candidate
                });
            }
        };

    pc.ontrack =
        event => {
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
                event.streams[0];

            audio.play().catch(
                error => {
                    console.warn(
                        "Audio playback needs user interaction:",
                        error
                    );
                }
            );
        };

    pc.onconnectionstatechange =
        () => {
            console.log(
                "Call connection:",
                pc.connectionState
            );

            if (
                pc.connectionState ===
                "connected"
            ) {
                callState =
                    "connected";

                renderCallScreen(
                    "Connected"
                );

                startCallTimer();
            }

            if (
                [
                    "failed",
                    "closed"
                ].includes(
                    pc.connectionState
                )
            ) {
                cleanupCall();

                if (
                    currentPage ===
                    "call"
                ) {
                    showHome();
                }
            }
        };

    return pc;
}

/* =====================================================
   START CALL
===================================================== */

async function startCall() {
    if (
        connectionState !==
        "connected"
    ) {
        alert(
            "Connect to another person first."
        );

        return;
    }

    if (
        callState !==
        "idle"
    ) {
        return;
    }

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {
        alert(
            "Microphone access is unavailable. Make sure VedChat is opened over HTTPS."
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

        currentCallId =
            crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString();

        pendingIceCandidates =
            [];

        peerConnection =
            createPeerConnection();

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

        callState =
            "calling";

        renderCallScreen(
            "Calling..."
        );

        const offer =
            await peerConnection.createOffer();

        await peerConnection.setLocalDescription(
            offer
        );

        send({
            type: "call",
            action: "offer",
            callId:
                currentCallId,
            offer
        });
    } catch (error) {
        console.error(
            "Start call error:",
            error
        );

        alert(
            "Could not access the microphone."
        );

        cleanupCall();
    }
}

/* =====================================================
   INCOMING CALL
===================================================== */

async function handleIncomingCall(
    message
) {
    if (
        callState !==
        "idle"
    ) {
        send({
            type:
                "call-decline",
            callId:
                message.callId,
            reason:
                "busy"
        });

        return;
    }

    currentCallId =
        message.callId;

    incomingCaller =
        message.sender ||
        "User";

    pendingOffer =
        message.offer;

    pendingIceCandidates =
        [];

    callState =
        "incoming";

    renderIncomingCall();
}

/* =====================================================
   INCOMING CALL UI
===================================================== */

function renderIncomingCall() {
    currentPage =
        "incoming-call";

    render(`
        <header>
            <div>
                <h1>📞 Incoming Call</h1>
                <small>VedChat</small>
            </div>
        </header>

        <main class="call-page">

            <div class="call-avatar">
                ${
                    escapeHTML(
                        incomingCaller
                            .charAt(0)
                            .toUpperCase()
                    )
                }
            </div>

            <h2>
                ${escapeHTML(
                    incomingCaller
                )}
            </h2>

            <p class="call-status">
                📞 Incoming audio call...
            </p>

            <button
                class="primary-btn answer-btn"
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

/* =====================================================
   ANSWER
===================================================== */

async function answerCall() {
    if (
        !pendingOffer
    ) {
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

        peerConnection =
            createPeerConnection();

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

        await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
                pendingOffer
            )
        );

        /*
         * Add any ICE candidates
         * that arrived before the
         * remote description.
         */
        await flushPendingIce();

        const answer =
            await peerConnection.createAnswer();

        await peerConnection.setLocalDescription(
            answer
        );

        callState =
            "connecting";

        renderCallScreen(
            "Connecting..."
        );

        send({
            type:
                "call-answer",
            callId:
                currentCallId,
            answer
        });
    } catch (error) {
        console.error(
            "Answer error:",
            error
        );

        alert(
            "Could not access the microphone."
        );

        cleanupCall();
        showHome();
    }
}

/* =====================================================
   CALL SIGNALS
===================================================== */

async function handleCallSignal(
    message
) {
    if (
        message.type ===
            "call" &&
        message.action ===
            "offer"
    ) {
        await handleIncomingCall(
            message
        );

        return;
    }

    if (
        message.type ===
        "call-answer"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        if (
            !peerConnection
        ) {
            return;
        }

        try {
            await peerConnection.setRemoteDescription(
                new RTCSessionDescription(
                    message.answer
                )
            );

            await flushPendingIce();
        } catch (error) {
            console.error(
                "Remote answer error:",
                error
            );
        }

        return;
    }

    if (
        message.type ===
        "ice-candidate"
    ) {
        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        if (
            peerConnection &&
            peerConnection.remoteDescription
        ) {
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
        } else {
            pendingIceCandidates.push(
                message.candidate
            );
        }

        return;
    }

    if (
        message.type ===
        "call-decline"
    ) {
        if (
            message.callId ===
            currentCallId
        ) {
            alert(
                "The other user declined the call."
            );

            cleanupCall();
            showHome();
        }

        return;
    }

    if (
        message.type ===
        "call-end"
    ) {
        if (
            message.callId ===
            currentCallId
        ) {
            cleanupCall();
            showHome();
        }
    }
}

/* =====================================================
   FLUSH ICE
===================================================== */

async function flushPendingIce() {
    if (
        !peerConnection ||
        !peerConnection.remoteDescription
    ) {
        return;
    }

    const candidates =
        pendingIceCandidates;

    pendingIceCandidates =
        [];

    for (
        const candidate of candidates
    ) {
        try {
            await peerConnection.addIceCandidate(
                new RTCIceCandidate(
                    candidate
                )
            );
        } catch (error) {
            console.error(
                "Pending ICE error:",
                error
            );
        }
    }
}

/* =====================================================
   DECLINE
===================================================== */

function declineCall() {
    send({
        type:
            "call-decline",
        callId:
            currentCallId
    });

    cleanupCall();

    showHome();
}

/* =====================================================
   END CALL
===================================================== */

function endCall(
    sendSignal = true
) {
    if (
        sendSignal &&
        currentCallId
    ) {
        send({
            type:
                "call-end",
            callId:
                currentCallId
        });
    }

    cleanupCall();

    showHome();
}

/* =====================================================
   CALL SCREEN
===================================================== */

function renderCallScreen(
    status
) {
    currentPage =
        "call";

    render(`
        <header>
            <div>
                <h1>📞 Call</h1>
                <small>VedChat audio call</small>
            </div>
        </header>

        <main class="call-page">

            <div class="call-avatar">
                📞
            </div>

            <h2>
                ${
                    escapeHTML(
                        incomingCaller ||
                        peerName ||
                        "VedChat User"
                    )
                }
            </h2>

            <p class="call-status">
                ${escapeHTML(status)}
            </p>

            <div
                id="callTimer"
                class="call-timer"
            >
                00:00
            </div>

            <button
                class="danger-btn"
                onclick="endCall(true)"
            >
                📵 End Call
            </button>

        </main>
    `);
}

/* =====================================================
   CALL TIMER
===================================================== */

function startCallTimer() {
    stopCallTimer();

    callSeconds = 0;

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
                    .padStart(2, "0");

            const seconds =
                (
                    callSeconds % 60
                )
                    .toString()
                    .padStart(2, "0");

            timer.textContent =
                `${minutes}:${seconds}`;
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

/* =====================================================
   CLEANUP CALL
===================================================== */

function cleanupCall() {
    stopCallTimer();

    if (localStream) {
        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );
    }

    if (peerConnection) {
        try {
            peerConnection.close();
        } catch {}
    }

    localStream = null;
    peerConnection = null;

    pendingOffer = null;
    pendingIceCandidates = [];

    callState =
        "idle";

    currentCallId = null;
    incomingCaller = "";
}

/* =====================================================
   PROFILE
===================================================== */

function showProfile() {
    currentPage =
        "profile";

    render(`
        <header>
            <div>
                <h1>👤 Profile</h1>
                <small>Your VedChat profile</small>
            </div>
        </header>

        <main>

            <section class="profile-card">

                <div class="profile-avatar">
                    ${
                        escapeHTML(
                            getName()
                                .charAt(0)
                                .toUpperCase()
                        )
                    }
                </div>

                <h2>
                    ${escapeHTML(
                        getName()
                    )}
                </h2>

                <p class="muted">
                    Display name
                </p>

            </section>

            <section class="card">

                <h3>Connection code</h3>

                <div class="profile-code">
                    ${
                        escapeHTML(
                            connectionCode ||
                            getSavedCode() ||
                            "Not created yet"
                        )
                    }
                </div>

            </section>

            <button
                class="primary-btn"
                onclick="editName()"
            >
                ✏️ Edit Display Name
            </button>

            <button
                class="secondary-btn"
                onclick="toggleDarkMode()"
            >
                🌙 Toggle Dark Mode
            </button>

        </main>

        ${bottomNav("profile")}
    `);
}

/* =====================================================
   EDIT NAME
===================================================== */

function editName() {
    const name =
        prompt(
            "Enter your display name:",
            getName()
        );

    if (
        !name ||
        !name.trim()
    ) {
        return;
    }

    const clean =
        name.trim().slice(
            0,
            40
        );

    setName(clean);

    /*
     * Re-register so the server
     * knows the updated name.
     */
    if (
        connectionState ===
        "connected"
    ) {
        sendRaw({
            type:
                "register",
            name:
                clean,
            code:
                getSavedCode()
        });
    }

    showProfile();
}

/* =====================================================
   DARK MODE
===================================================== */

function toggleDarkMode() {
    document.body.classList.toggle(
        "dark"
    );

    localStorage.setItem(
        "vedchat_dark",
        document.body.classList.contains(
            "dark"
        )
            ? "1"
            : "0"
    );
}

function loadDarkMode() {
    if (
        localStorage.getItem(
            "vedchat_dark"
        ) === "1"
    ) {
        document.body.classList.add(
            "dark"
        );
    }
}

/* =====================================================
   HOME
===================================================== */

function showHome() {
    currentPage =
        "home";

    render(`
        <header>
            <div>
                <h1>💜 VedChat</h1>
                <small>Private real-time chat</small>
            </div>

            <div class="header-status">
                <span class="status-dot"></span>
                <span class="connection-status">
                    ${escapeHTML(
                        connectionState
                    )}
                </span>
            </div>
        </header>

        <main>

            <section class="welcome-card">

                <div class="welcome-avatar">
                    ${
                        escapeHTML(
                            getName()
                                .charAt(0)
                                .toUpperCase()
                        )
                    }
                </div>

                <div>
                    <h2>
                        Hi, ${
                            escapeHTML(
                                getName()
                            )
                        }! 👋
                    </h2>

                    <p>
                        ${
                            peerName
                                ? "Connected to " +
                                  escapeHTML(
                                      peerName
                                  )
                                : "Connect with someone to start chatting."
                        }
                    </p>
                </div>

            </section>

            <section class="feature-grid">

                <button
                    class="feature-card"
                    onclick="showChats()"
                >
                    <span>💬</span>
                    <strong>Chats</strong>
                    <small>Real-time messages</small>
                </button>

                <button
                    class="feature-card"
                    onclick="showConnection()"
                >
                    <span>🔗</span>
                    <strong>Connect</strong>
                    <small>10-character code</small>
                </button>

                <button
                    class="feature-card"
                    onclick="showProfile()"
                >
                    <span>👤</span>
                    <strong>Profile</strong>
                    <small>Your account</small>
                </button>

                <button
                    class="feature-card"
                    onclick="startCall()"
                >
                    <span>📞</span>
                    <strong>Call</strong>
                    <small>Audio calling</small>
                </button>

            </section>

            <section class="card">

                <h3>Connection</h3>

                <p class="muted">
                    Your code
                </p>

                <div class="home-code">
                    ${
                        escapeHTML(
                            connectionCode ||
                            getSavedCode() ||
                            "Connecting..."
                        )
                    }
                </div>

                <button
                    class="secondary-btn"
                    onclick="copyConnectionCode()"
                >
                    📋 Copy Code
                </button>

            </section>

        </main>

        ${bottomNav("home")}
    `);

    updateConnectionIndicator();
}

/* =====================================================
   BOTTOM NAV
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
                Home
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
                Chats
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
                Profile
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

    if (!app) {
        return;
    }

    app.innerHTML = `
        <div class="app">
            ${content}
        </div>
    `;

    updateConnectionIndicator();
}

/* =====================================================
   TOAST
===================================================== */

function showToast(message) {
    const old =
        document.querySelector(
            ".toast"
        );

    if (old) {
        old.remove();
    }

    const toast =
        document.createElement(
            "div"
        );

    toast.className =
        "toast";

    toast.textContent =
        message;

    document.body.appendChild(
        toast
    );

    setTimeout(() => {
        toast.classList.add(
            "show"
        );
    }, 10);

    setTimeout(() => {
        toast.classList.remove(
            "show"
        );

        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 2500);
}

/* =====================================================
   START
===================================================== */

loadDarkMode();

if (
    !localStorage.getItem(
        "vedchat_name"
    )
) {
    const name =
        prompt(
            "What is your display name?"
        );

    setName(
        name &&
        name.trim()
            ? name.trim().slice(
                  0,
                  40
              )
            : "Guest"
    );
}

connectionCode =
    getSavedCode();

connectToServer();

showHome();