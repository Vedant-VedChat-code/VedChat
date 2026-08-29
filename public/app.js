/* =====================================================
   VEDCHAT CLIENT
===================================================== */

let ws = null;

let connectionState = "offline";

let connectionCode =
    localStorage.getItem("connectionCode") || "";

let currentPage = "home";

let peerName = "";

let peerConnection = null;

let localStream = null;

let pendingIceCandidates = [];

let callState = "idle";

let currentCallId = null;

let incomingCaller = "";

let pendingOffer = null;

let callTimer = null;

let callSeconds = 0;

/* =====================================================
   PROFILE
===================================================== */

function getName() {
    return (
        localStorage.getItem("displayName") ||
        "Guest"
    );
}

function setName(name) {
    localStorage.setItem(
        "displayName",
        name
    );
}

/* =====================================================
   HTML ESCAPE
===================================================== */

function escapeHTML(text) {
    const div =
        document.createElement("div");

    div.textContent =
        String(text);

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
   CONNECT TO SERVER
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

    updateStatusUI();

    try {

        ws = new WebSocket(
            getWebSocketURL()
        );

    } catch (error) {

        console.error(error);

        connectionState =
            "offline";

        updateStatusUI();

        return;
    }

    ws.onopen = () => {

        connectionState =
            "connected";

        updateStatusUI();

        console.log(
            "Connected to VedChat"
        );

        /*
           Restore this user's code
           automatically.
        */

        const savedCode =
            localStorage.getItem(
                "connectionCode"
            );

        if (savedCode) {

            send({
                type: "register",
                name: getName(),
                code: savedCode
            });
        } else {

            send({
                type: "register",
                name: getName()
            });
        }
    };

    ws.onclose = () => {

        connectionState =
            "offline";

        updateStatusUI();

        setTimeout(
            connectToServer,
            3000
        );
    };

    ws.onerror = error => {

        console.error(
            "WebSocket error:",
            error
        );

        connectionState =
            "offline";

        updateStatusUI();
    };

    ws.onmessage = event => {

        let message;

        try {

            message =
                JSON.parse(
                    event.data
                );

        } catch (error) {

            console.error(
                "Invalid server message"
            );

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

function send(data) {

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

    alert(
        "VedChat is not connected to the server."
    );

    return false;
}

/* =====================================================
   SERVER MESSAGE HANDLER
===================================================== */

function handleServerMessage(message) {

    /* -------------------------------------------------
       SERVER READY
    ------------------------------------------------- */

    if (
        message.type ===
        "server-ready"
    ) {
        return;
    }

    /* -------------------------------------------------
       REGISTERED
    ------------------------------------------------- */

    if (
        message.type ===
        "registered"
    ) {

        connectionCode =
            message.code;

        localStorage.setItem(
            "connectionCode",
            connectionCode
        );

        /*
           If this is the first registration,
           show the code.
        */

        if (
            !localStorage.getItem(
                "codeShown"
            )
        ) {

            localStorage.setItem(
                "codeShown",
                "true"
            );
        }

        updateStatusUI();

        return;
    }

    /* -------------------------------------------------
       CONNECTED TO PERSON
    ------------------------------------------------- */

    if (
        message.type ===
        "connected"
    ) {

        peerName =
            message.name ||
            "User";

        alert(
            "🟢 Connected to " +
            peerName
        );

        showChats();

        return;
    }

    /* -------------------------------------------------
       PERSON JOINED
    ------------------------------------------------- */

    if (
        message.type ===
        "peer-joined"
    ) {

        peerName =
            message.name ||
            "User";

        alert(
            "🟢 " +
            peerName +
            " connected to your VedChat!"
        );

        return;
    }

    /* -------------------------------------------------
       PERSON LEFT
    ------------------------------------------------- */

    if (
        message.type ===
        "peer-left"
    ) {

        peerName = "";

        if (
            callState !== "idle"
        ) {
            cleanupCall();
        }

        if (
            currentPage === "chat"
        ) {
            displayMessages();
        }

        alert(
            "The other user disconnected."
        );

        return;
    }

    /* -------------------------------------------------
       CHAT
    ------------------------------------------------- */

    if (
        message.type ===
        "chat"
    ) {

        receiveChat(
            message
        );

        return;
    }

    /* -------------------------------------------------
       CALLING
    ------------------------------------------------- */

    if (
        [
            "call",
            "call-answer",
            "offer",
            "answer",
            "ice-candidate",
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

    /* -------------------------------------------------
       PROFILE
    ------------------------------------------------- */

    if (
        message.type ===
        "profile"
    ) {

        connectionCode =
            message.code;

        peerName =
            message.name || "";

        return;
    }

    /* -------------------------------------------------
       ERROR
    ------------------------------------------------- */

    if (
        message.type ===
        "error"
    ) {

        alert(
            "VedChat: " +
            message.message
        );

        return;
    }
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
        JSON.stringify(messages)
    );
}

function addLocalMessage(
    sender,
    text,
    time
) {

    const messages =
        getMessages();

    messages.push({
        sender,
        text,
        time
    });

    /*
       Keep the latest 500 messages.
    */

    while (
        messages.length > 500
    ) {
        messages.shift();
    }

    saveMessages(messages);
}

/* =====================================================
   RECEIVE CHAT
===================================================== */

function receiveChat(message) {

    addLocalMessage(
        message.sender,
        message.text,
        message.time
    );

    peerName =
        message.sender ||
        peerName;

    if (
        currentPage === "chat"
    ) {
        displayMessages();
    }
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
            "VedChat is offline."
        );

        return;
    }

    if (!connectionCode) {

        alert(
            "Connect to someone first."
        );

        return;
    }

    const time =
        new Date().toISOString();

    /*
       Display immediately for sender.
    */

    addLocalMessage(
        getName(),
        text,
        time
    );

    /*
       Send immediately to peer.
    */

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
   DISPLAY CHAT
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
                No messages yet.
            </div>
        `;

        return;
    }

    for (
        const message of messages
    ) {

        const mine =
            message.sender ===
            getName();

        const bubble =
            document.createElement(
                "div"
            );

        bubble.className =
            "message " +
            (
                mine
                    ? "mine"
                    : "theirs"
            );

        let timeText = "";

        try {

            timeText =
                new Date(
                    message.time
                ).toLocaleTimeString(
                    [],
                    {
                        hour: "2-digit",
                        minute: "2-digit"
                    }
                );

        } catch {
            timeText = "";
        }

        bubble.innerHTML = `
            <div class="message-sender">
                ${escapeHTML(
                    message.sender
                )}
            </div>

            <div class="message-text">
                ${escapeHTML(
                    message.text
                )}
            </div>

            <span class="message-time">
                ${escapeHTML(
                    timeText
                )}
            </span>
        `;

        area.appendChild(
            bubble
        );
    }

    area.scrollTop =
        area.scrollHeight;
}

/* =====================================================
   CHATS PAGE
===================================================== */

function showChats() {

    currentPage =
        "chats";

    render(`
        <header>
            <div>
                <h1>💬 Chats</h1>
                <small>
                    Real-time messaging
                </small>
            </div>
        </header>

        <main>

            <div class="chat-item">

                <div class="avatar">
                    ${
                        peerName
                            ? escapeHTML(
                                peerName
                                    .charAt(0)
                                    .toUpperCase()
                            )
                            : "?"
                    }
                </div>

                <div class="chat-info">

                    <div class="chat-name">
                        ${
                            escapeHTML(
                                peerName ||
                                "No connection"
                            )
                        }
                    </div>

                    <div class="last-message">
                        ${
                            peerName
                                ? "Tap to open chat"
                                : "Connect to someone"
                        }
                    </div>

                </div>

            </div>

            <button
                class="primary-btn"
                onclick="openMainChat()"
            >
                💬 Open Chat
            </button>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                🔗 Connection
            </button>

        </main>

        ${bottomNav("chats")}
    `);
}

/* =====================================================
   OPEN CHAT
===================================================== */

function openMainChat() {

    currentPage =
        "chat";

    render(`
        <header>

            <div>
                <h1>💬 Chat</h1>

                <small>
                    ${
                        escapeHTML(
                            peerName ||
                            "VedChat"
                        )
                    }
                </small>
            </div>

        </header>

        <main>

            <div
                id="messageArea"
                class="message-area"
            ></div>

            <div
                class="message-input-area"
            >

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
                    Send
                </button>

            </div>

            <button
                class="primary-btn"
                onclick="startCall()"
            >
                📞 Voice Call
            </button>

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

        input.focus();

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
    }

    displayMessages();
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
                <h1>🔗 Connection</h1>

                <small>
                    Connect with another person
                </small>
            </div>

        </header>

        <main>

            <div class="status">
                Server:

                <strong
                    class="${
                        connectionState ===
                        "connected"
                            ? "online"
                            : connectionState ===
                              "connecting"
                                ? "connecting"
                                : "offline"
                    }"
                >
                    ${connectionState}
                </strong>
            </div>

            <h3>
                Your 10-character code
            </h3>

            <div class="connection-code">
                ${escapeHTML(
                    connectionCode ||
                    "----------"
                )}
            </div>

            <div id="qrcode"></div>

            <button
                class="primary-btn"
                onclick="copyConnectionCode()"
            >
                📋 Copy My Code
            </button>

            <hr>

            <h3>
                Connect to someone
            </h3>

            <input
                id="joinCode"
                maxlength="10"
                placeholder="10-character code"
                autocomplete="off"
                style="text-transform:uppercase;"
            >

            <button
                class="primary-btn"
                onclick="connectToUser()"
            >
                🚀 Connect
            </button>

            <button
                class="secondary-btn"
                onclick="showHome()"
            >
                ← Home
            </button>

        </main>

        ${bottomNav("home")}
    `);

    generateQR();
}

/* =====================================================
   GENERATE QR
===================================================== */

function generateQR() {

    const qr =
        document.getElementById(
            "qrcode"
        );

    if (!qr) {
        return;
    }

    qr.innerHTML = "";

    if (!connectionCode) {

        qr.innerHTML = `
            <div class="empty">
                Your code is not ready yet.
            </div>
        `;

        return;
    }

    if (
        typeof QRCode ===
        "undefined"
    ) {

        qr.innerHTML = `
            <div class="empty">
                QR library not found.
                <br><br>
                Make sure qrcode.min.js
                is inside public/.
            </div>
        `;

        return;
    }

    try {

        new QRCode(
            qr,
            {
                text:
                    connectionCode,

                width: 220,

                height: 220,

                correctLevel:
                    QRCode.CorrectLevel
                        ? QRCode.CorrectLevel.M
                        : undefined
            }
        );

    } catch (error) {

        console.error(
            "QR error:",
            error
        );

        qr.innerHTML = `
            <div class="empty">
                Could not create QR code.
            </div>
        `;
    }
}

/* =====================================================
   COPY CODE
===================================================== */

function copyConnectionCode() {

    if (!connectionCode) {

        alert(
            "Your connection code is not ready."
        );

        return;
    }

    if (
        navigator.clipboard
    ) {

        navigator.clipboard
            .writeText(
                connectionCode
            )
            .then(() => {

                alert(
                    "Connection code copied!"
                );

            })
            .catch(() => {

                alert(
                    "Your code is:\n" +
                    connectionCode
                );
            });

    } else {

        alert(
            "Your code is:\n" +
            connectionCode
        );
    }
}

/* =====================================================
   CONNECT TO USER
===================================================== */

function connectToUser() {

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
            "Wait for the server to connect."
        );

        return;
    }

    /*
       Important:
       Do NOT replace our own permanent code.
       The entered code is the person's code
       we want to connect to.
    */

    send({
        type: "connect",
        code,
        name: getName()
    });
}

/* =====================================================
   REAL WEBRTC CALLING
===================================================== */

async function startCall() {

    if (
        connectionState !==
        "connected"
    ) {

        alert(
            "VedChat is offline."
        );

        return;
    }

    if (!peerName) {

        alert(
            "Connect to another user first."
        );

        return;
    }

    if (
        callState !== "idle"
    ) {
        return;
    }

    try {

        localStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: true,
                    video: false
                });

        currentCallId =
            crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString();

        pendingIceCandidates = [];

        peerConnection =
            createPeerConnection();

        for (
            const track of
            localStream.getTracks()
        ) {

            peerConnection.addTrack(
                track,
                localStream
            );
        }

        callState =
            "calling";

        renderCallScreen(
            "Calling..."
        );

        const offer =
            await peerConnection
                .createOffer();

        await peerConnection
            .setLocalDescription(
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
            "Microphone permission is required for calling."
        );

        cleanupCall();
    }
}

/* =====================================================
   CREATE PEER CONNECTION
===================================================== */

function createPeerConnection() {

    const pc =
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

    /* -------------------------------------------------
       ICE
    ------------------------------------------------- */

    pc.onicecandidate =
        event => {

            if (
                event.candidate
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

    /* -------------------------------------------------
       REMOTE AUDIO
    ------------------------------------------------- */

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

    /* -------------------------------------------------
       CONNECTION STATE
    ------------------------------------------------- */

    pc.onconnectionstatechange =
        () => {

            console.log(
                "WebRTC state:",
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
                    showChats();
                }
            }
        };

    return pc;
}

/* =====================================================
   INCOMING CALL
===================================================== */

function handleIncomingCall(
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

                <small>
                    VedChat
                </small>
            </div>

        </header>

        <main
            style="text-align:center;"
        >

            <div class="call-avatar">
                ${escapeHTML(
                    incomingCaller
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <h2>
                ${escapeHTML(
                    incomingCaller
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

/* =====================================================
   ANSWER CALL
===================================================== */

async function answerCall() {

    try {

        localStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: true,
                    video: false
                });

        pendingIceCandidates = [];

        peerConnection =
            createPeerConnection();

        for (
            const track of
            localStream.getTracks()
        ) {

            peerConnection.addTrack(
                track,
                localStream
            );
        }

        await peerConnection
            .setRemoteDescription(
                new RTCSessionDescription(
                    pendingOffer
                )
            );

        const answer =
            await peerConnection
                .createAnswer();

        await peerConnection
            .setLocalDescription(
                answer
            );

        send({
            type:
                "call-answer",

            callId:
                currentCallId,

            answer
        });

        callState =
            "calling";

        renderCallScreen(
            "Connecting..."
        );

        /*
           Add ICE candidates that arrived
           while the remote description
           was being prepared.
        */

        await flushPendingIce();

    } catch (error) {

        console.error(
            "Answer error:",
            error
        );

        alert(
            "Could not access the microphone."
        );

        send({
            type:
                "call-decline",

            callId:
                currentCallId
        });

        cleanupCall();

        showChats();
    }
}

/* =====================================================
   CALL SIGNAL HANDLER
===================================================== */

async function handleCallSignal(
    message
) {

    /* -------------------------------------------------
       OFFER
    ------------------------------------------------- */

    if (
        message.type === "call" &&
        message.action === "offer"
    ) {

        handleIncomingCall(
            message
        );

        return;
    }

    /* -------------------------------------------------
       ANSWER
    ------------------------------------------------- */

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

        if (!peerConnection) {
            return;
        }

        try {

            await peerConnection
                .setRemoteDescription(
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

    /* -------------------------------------------------
       ICE CANDIDATE
    ------------------------------------------------- */

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

        if (!peerConnection) {
            return;
        }

        /*
           Sometimes ICE arrives before
           setRemoteDescription().
        */

        if (
            peerConnection
                .remoteDescription
        ) {

            try {

                await peerConnection
                    .addIceCandidate(
                        message.candidate
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

    /* -------------------------------------------------
       CALL DECLINED
    ------------------------------------------------- */

    if (
        message.type ===
        "call-decline"
    ) {

        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        alert(
            "The other user declined the call."
        );

        cleanupCall();

        showChats();

        return;
    }

    /* -------------------------------------------------
       CALL ENDED
    ------------------------------------------------- */

    if (
        message.type ===
        "call-end"
    ) {

        if (
            message.callId !==
            currentCallId
        ) {
            return;
        }

        cleanupCall();

        alert(
            "Call ended."
        );

        showChats();

        return;
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

    pendingIceCandidates = [];

    for (
        const candidate of candidates
    ) {

        try {

            await peerConnection
                .addIceCandidate(
                    candidate
                );

        } catch (error) {

            console.error(
                "Queued ICE error:",
                error
            );
        }
    }
}

/* =====================================================
   DECLINE
===================================================== */

function declineCall() {

    if (currentCallId) {

        send({
            type:
                "call-decline",

            callId:
                currentCallId
        });
    }

    cleanupCall();

    showChats();
}

/* =====================================================
   END CALL
===================================================== */

function endCall() {

    if (currentCallId) {

        send({
            type:
                "call-end",

            callId:
                currentCallId
        });
    }

    cleanupCall();

    showChats();
}

/* =====================================================
   CLEANUP CALL
===================================================== */

function cleanupCall() {

    stopCallTimer();

    if (localStream) {

        for (
            const track of
            localStream.getTracks()
        ) {

            track.stop();
        }
    }

    if (peerConnection) {

        try {
            peerConnection.close();
        } catch (error) {
            console.error(error);
        }
    }

    const audio =
        document.getElementById(
            "remoteAudio"
        );

    if (audio) {
        audio.remove();
    }

    localStream = null;

    peerConnection = null;

    pendingIceCandidates = [];

    pendingOffer = null;

    currentCallId = null;

    incomingCaller = "";

    callState = "idle";
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
                <h1>📞 Voice Call</h1>

                <small>
                    VedChat
                </small>
            </div>

        </header>

        <main>

            <div class="call-avatar">
                📞
            </div>

            <h2
                style="text-align:center;"
            >
                ${escapeHTML(
                    incomingCaller ||
                    peerName ||
                    "User"
                )}
            </h2>

            <div class="call-status">
                ${escapeHTML(status)}
            </div>

            <div
                id="callTimer"
                class="call-timer"
            >
                00:00
            </div>

            <button
                class="danger-btn"
                onclick="endCall()"
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

                <small>
                    Your VedChat account
                </small>
            </div>

        </header>

        <main>

            <div class="profile-card">

                <div
                    class="avatar"
                    style="
                        width:90px;
                        height:90px;
                        margin:auto;
                        font-size:35px;
                    "
                >
                    ${escapeHTML(
                        getName()
                            .charAt(0)
                            .toUpperCase()
                    )}
                </div>

                <h2>
                    ${escapeHTML(
                        getName()
                    )}
                </h2>

                <p>
                    Your connection code:
                </p>

                <div class="connection-code">
                    ${escapeHTML(
                        connectionCode ||
                        "----------"
                    )}
                </div>

            </div>

            <button
                class="primary-btn"
                onclick="editName()"
            >
                ✏️ Edit Display Name
            </button>

            <button
                class="secondary-btn"
                onclick="showConnection()"
            >
                🔗 My Connection Code
            </button>

        </main>

        ${bottomNav("profile")}
    `);
}

/* =====================================================
   EDIT NAME
===================================================== */

function editName() {

    const newName =
        prompt(
            "Enter your display name:",
            getName()
        );

    if (
        !newName ||
        !newName.trim()
    ) {
        return;
    }

    setName(
        newName.trim()
    );

    /*
       Update server profile while
       keeping the same code.
    */

    if (
        connectionState ===
        "connected" &&
        connectionCode
    ) {

        send({
            type:
                "register",

            name:
                getName(),

            code:
                connectionCode
        });
    }

    showProfile();
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
                <h1>VedChat</h1>

                <small>
                    Real-time private chat
                </small>
            </div>

        </header>

        <main>

            <h2>
                Welcome,
                ${escapeHTML(
                    getName()
                )}! 👋
            </h2>

            <div class="status">

                Server:

                <strong
                    class="${
                        connectionState ===
                        "connected"
                            ? "online"
                            : connectionState ===
                              "connecting"
                                ? "connecting"
                                : "offline"
                    }"
                >
                    ${connectionState}
                </strong>

            </div>

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
                🔗 Connection
            </button>

            <button
                class="secondary-btn"
                onclick="showProfile()"
            >
                👤 Profile
            </button>

        </main>

        ${bottomNav("home")}
    `);
}

/* =====================================================
   STATUS UPDATE
===================================================== */

function updateStatusUI() {

    if (
        currentPage ===
        "home"
    ) {
        showHome();
    }

    if (
        currentPage ===
        "connection"
    ) {
        showConnection();
    }
}

/* =====================================================
   BOTTOM NAVIGATION
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
                <br>
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
                💬
                <br>
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
                👤
                <br>
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
}

/* =====================================================
   FIRST START
===================================================== */

if (
    !localStorage.getItem(
        "displayName"
    )
) {

    const name =
        prompt(
            "What is your display name?"
        );

    setName(
        name &&
        name.trim()
            ? name.trim()
            : "Guest"
    );
}

/* =====================================================
   START VEDCHAT
===================================================== */

connectToServer();

showHome();