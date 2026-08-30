/* =====================================================
   VEDCHAT FRONTEND
===================================================== */

"use strict";


/* =====================================================
   ELEMENTS
===================================================== */

const registerScreen =
    document.getElementById("registerScreen");

const mainScreen =
    document.getElementById("mainScreen");

const nameInput =
    document.getElementById("nameInput");

const codeInput =
    document.getElementById("codeInput");

const registerButton =
    document.getElementById("registerButton");

const registerStatus =
    document.getElementById("registerStatus");

const friendsList =
    document.getElementById("friendsList");

const groupsList =
    document.getElementById("groupsList");

const friendsTab =
    document.getElementById("friendsTab");

const groupsTab =
    document.getElementById("groupsTab");

const createGroupButton =
    document.getElementById("createGroupButton");

const emptyChat =
    document.getElementById("emptyChat");

const chatWindow =
    document.getElementById("chatWindow");

const chatAvatar =
    document.getElementById("chatAvatar");

const chatName =
    document.getElementById("chatName");

const chatStatus =
    document.getElementById("chatStatus");

const messages =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const addFriendButton =
    document.getElementById("addFriendButton");

const profileButton =
    document.getElementById("profileButton");

const backButton =
    document.getElementById("backButton");

const callButton =
    document.getElementById("callButton");


/* =====================================================
   STATE
===================================================== */

let socket = null;

let myCode =
    localStorage.getItem("vedchat_code") || "";

let myName =
    localStorage.getItem("vedchat_name") || "";

let myAvatar =
    localStorage.getItem("vedchat_avatar") || "";

let friends = [];

let groups = [];

let currentChat = null;

let currentChatType = null;


/* =====================================================
   STORAGE
===================================================== */

function saveAccount() {

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
}


/* =====================================================
   WEBSOCKET
===================================================== */

function connect() {

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    const url =
        protocol +
        "//" +
        location.host;

    socket = new WebSocket(url);


    socket.addEventListener(
        "open",
        () => {

            setStatus(
                registerStatus,
                "Connecting..."
            );

            socket.send(
                JSON.stringify({
                    type: "register",
                    name: myName ||
                        nameInput.value.trim(),
                    code: myCode,
                    avatar: myAvatar
                })
            );
        }
    );


    socket.addEventListener(
        "message",
        event => {

            let data;

            try {
                data =
                    JSON.parse(event.data);
            } catch {
                return;
            }

            handleMessage(data);
        }
    );


    socket.addEventListener(
        "close",
        () => {

            setStatus(
                registerStatus,
                "Disconnected. Reconnecting..."
            );

            setTimeout(
                connect,
                2000
            );
        }
    );


    socket.addEventListener(
        "error",
        () => {

            setStatus(
                registerStatus,
                "Connection error."
            );
        }
    );
}


function send(data) {

    if (
        !socket ||
        socket.readyState !== WebSocket.OPEN
    ) {
        return false;
    }

    socket.send(
        JSON.stringify(data)
    );

    return true;
}


/* =====================================================
   SERVER MESSAGES
===================================================== */

function handleMessage(data) {

    switch (data.type) {

        case "server-ready":
            break;


        case "registered":

            myCode = data.code;
            myName = data.name;
            myAvatar = data.avatar || "";

            friends =
                data.friends || [];

            saveAccount();

            showMainApp();

            requestFriends();
            requestGroups();

            break;


        case "error":

            setStatus(
                registerStatus,
                data.message
            );

            setStatus(
                document.getElementById(
                    "friendStatus"
                ),
                data.message
            );

            setStatus(
                document.getElementById(
                    "profileStatus"
                ),
                data.message
            );

            setStatus(
                document.getElementById(
                    "groupStatus"
                ),
                data.message
            );

            break;


        case "friends-list":

            renderFriends(
                data.friends || []
            );

            break;


        case "friends-updated":

            friends =
                data.friends || [];

            requestFriends();

            break;


        case "friend-added":

            requestFriends();

            break;


        case "friend-profile-updated":

            requestFriends();

            break;


        case "presence":

            requestFriends();

            if (
                currentChatType === "private" &&
                currentChat === data.code
            ) {
                chatStatus.textContent =
                    data.online
                        ? "Online"
                        : "Offline";
            }

            break;


        case "user-found":

            showUserResult(
                data.user,
                data.online
            );

            break;


        case "private-chat":

            receivePrivateMessage(data);

            break;


        case "groups-list":

            groups =
                data.groups || [];

            renderGroups();

            break;


        case "group-created":

            requestGroups();

            closeModal("groupModal");

            openGroup(
                data.group
            );

            break;


        case "group-joined":

            requestGroups();

            break;


        case "group-member-joined":

            if (
                currentChatType === "group" &&
                currentChat === data.groupId
            ) {
                addSystemMessage(
                    `${data.name} joined the group.`
                );
            }

            break;


        case "group-chat":

            receiveGroupMessage(data);

            break;


        case "profile-updated":

            myName = data.name;
            myAvatar = data.avatar || "";

            saveAccount();

            requestFriends();

            updateProfileUI();

            break;


        default:

            handleCallSignal(data);

            break;
    }
}


/* =====================================================
   REGISTER
===================================================== */

registerButton.addEventListener(
    "click",
    register
);


nameInput.addEventListener(
    "keydown",
    event => {

        if (event.key === "Enter") {
            register();
        }
    }
);


function register() {

    const name =
        nameInput.value.trim();

    if (!name) {

        setStatus(
            registerStatus,
            "Please enter your name."
        );

        return;
    }

    myName = name;

    myCode =
        codeInput.value.trim().toUpperCase();

    setStatus(
        registerStatus,
        "Connecting..."
    );

    connect();
}


/* =====================================================
   SHOW APP
===================================================== */

function showMainApp() {

    registerScreen.classList.add(
        "hidden"
    );

    mainScreen.classList.remove(
        "hidden"
    );

    updateProfileUI();
}


/* =====================================================
   FRIENDS
===================================================== */

function requestFriends() {

    send({
        type: "get-friends"
    });
}


function renderFriends(list) {

    friends = list;

    friendsList.innerHTML = "";

    if (!list.length) {

        friendsList.innerHTML =
            emptyList(
                "No friends yet.<br>Add someone using their code."
            );

        return;
    }


    list.forEach(friend => {

        const item =
            document.createElement("div");

        item.className =
            "contact";

        if (
            currentChatType === "private" &&
            currentChat === friend.code
        ) {
            item.classList.add("active");
        }


        const avatar =
            createAvatar(
                friend.name,
                friend.avatar
            );


        const info =
            document.createElement("div");

        info.className =
            "contact-info";


        const name =
            document.createElement("span");

        name.className =
            "contact-name";

        name.textContent =
            friend.name;


        const code =
            document.createElement("span");

        code.className =
            "contact-code";

        code.textContent =
            friend.code;


        info.appendChild(name);
        info.appendChild(code);


        const dot =
            document.createElement("span");

        dot.className =
            "online-dot";

        if (friend.online) {
            dot.classList.add("online");
        }


        item.appendChild(avatar);
        item.appendChild(info);
        item.appendChild(dot);


        item.addEventListener(
            "click",
            () => openPrivateChat(friend)
        );


        friendsList.appendChild(item);
    });
}


/* =====================================================
   PRIVATE CHAT
===================================================== */

function openPrivateChat(friend) {

    currentChat =
        friend.code;

    currentChatType =
        "private";

    chatName.textContent =
        friend.name;

    chatStatus.textContent =
        friend.online
            ? "Online"
            : "Offline";

    setAvatar(
        chatAvatar,
        friend.name,
        friend.avatar
    );

    messages.innerHTML = "";

    loadPrivateHistory(
        friend.code
    );

    showChat();

    renderFriends(friends);
}


function receivePrivateMessage(data) {

    const other =
        data.from === myCode
            ? data.to
            : data.from;


    if (
        currentChatType === "private" &&
        currentChat === other
    ) {

        addMessage(
            data,
            data.from === myCode
        );

        scrollMessages();

    } else {

        /*
         * Message received while another chat
         * is open.
         */

        requestFriends();
    }
}


function sendPrivateMessage() {

    const text =
        messageInput.value.trim();

    if (!text) return;

    if (
        currentChatType !== "private"
    ) {
        return;
    }

    const sent =
        send({
            type: "private-chat",
            to: currentChat,
            text
        });

    if (sent) {

        messageInput.value = "";

        /*
         * Server echoes the message back.
         */
    }
}


/* =====================================================
   GROUPS
===================================================== */

function requestGroups() {

    send({
        type: "get-groups"
    });
}


function renderGroups() {

    groupsList.innerHTML = "";

    if (!groups.length) {

        groupsList.innerHTML =
            emptyList(
                "No groups yet."
            );

        return;
    }


    groups.forEach(group => {

        const item =
            document.createElement("div");

        item.className =
            "contact";

        if (
            currentChatType === "group" &&
            currentChat === group.id
        ) {
            item.classList.add("active");
        }


        const avatar =
            document.createElement("div");

        avatar.className =
            "avatar";

        avatar.textContent =
            "👥";


        const info =
            document.createElement("div");

        info.className =
            "contact-info";


        const name =
            document.createElement("span");

        name.className =
            "contact-name";

        name.textContent =
            group.name;


        const count =
            document.createElement("span");

        count.className =
            "contact-code";

        count.textContent =
            `${group.members.length} members`;


        info.appendChild(name);
        info.appendChild(count);

        item.appendChild(avatar);
        item.appendChild(info);


        item.addEventListener(
            "click",
            () => openGroup(group)
        );


        groupsList.appendChild(item);
    });
}


function openGroup(group) {

    currentChat =
        group.id;

    currentChatType =
        "group";

    chatName.textContent =
        group.name;

    chatStatus.textContent =
        `${group.members.length} members`;

    chatAvatar.textContent =
        "👥";

    messages.innerHTML = "";

    showChat();

    renderGroups();
}


function receiveGroupMessage(data) {

    if (
        currentChatType === "group" &&
        currentChat === data.groupId
    ) {

        addMessage(
            data,
            data.from === myCode
        );

        scrollMessages();

    }
}


function sendGroupMessage() {

    const text =
        messageInput.value.trim();

    if (!text) return;

    if (
        currentChatType !== "group"
    ) {
        return;
    }

    const sent =
        send({
            type: "group-chat",
            groupId: currentChat,
            text
        });

    if (sent) {
        messageInput.value = "";
    }
}


/* =====================================================
   MESSAGE INPUT
===================================================== */

sendButton.addEventListener(
    "click",
    () => {

        if (
            currentChatType === "private"
        ) {
            sendPrivateMessage();
        }

        if (
            currentChatType === "group"
        ) {
            sendGroupMessage();
        }
    }
);


messageInput.addEventListener(
    "keydown",
    event => {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            sendButton.click();
        }
    }
);


/* =====================================================
   MESSAGE RENDERING
===================================================== */

function addMessage(
    data,
    mine
) {

    const row =
        document.createElement("div");

    row.className =
        "message-row";

    if (mine) {
        row.classList.add("mine");
    }


    const bubble =
        document.createElement("div");

    bubble.className =
        "message";


    if (
        !mine &&
        currentChatType === "group"
    ) {

        const sender =
            document.createElement("div");

        sender.className =
            "message-sender";

        sender.textContent =
            data.sender || "User";

        bubble.appendChild(sender);
    }


    const text =
        document.createElement("div");

    text.textContent =
        data.text || "";

    bubble.appendChild(text);


    const time =
        document.createElement("span");

    time.className =
        "message-time";

    time.textContent =
        formatTime(data.time);

    bubble.appendChild(time);


    row.appendChild(bubble);

    messages.appendChild(row);
}


function addSystemMessage(text) {

    const row =
        document.createElement("div");

    row.className =
        "message-row";


    const bubble =
        document.createElement("div");

    bubble.className =
        "message";

    bubble.style.opacity =
        "0.7";

    bubble.textContent =
        text;


    row.appendChild(bubble);

    messages.appendChild(row);

    scrollMessages();
}


function scrollMessages() {

    messages.scrollTop =
        messages.scrollHeight;
}


/* =====================================================
   LOCAL HISTORY
===================================================== */

function historyKey() {

    if (
        currentChatType === "private"
    ) {

        const codes = [
            myCode,
            currentChat
        ].sort();

        return (
            "vedchat_private_" +
            codes.join("_")
        );
    }

    return (
        "vedchat_group_" +
        currentChat
    );
}


function loadPrivateHistory(code) {

    const key =
        "vedchat_private_" +
        [myCode, code]
            .sort()
            .join("_");

    let history = [];

    try {

        history =
            JSON.parse(
                localStorage.getItem(key)
            ) || [];

    } catch {

        history = [];
    }


    history.forEach(message => {

        addMessage(
            message,
            message.from === myCode
        );
    });


    scrollMessages();
}


function saveMessageLocally(data) {

    if (
        data.type !== "private-chat"
    ) {
        return;
    }

    const codes = [
        data.from,
        data.to
    ].sort();

    const key =
        "vedchat_private_" +
        codes.join("_");


    let history = [];

    try {

        history =
            JSON.parse(
                localStorage.getItem(key)
            ) || [];

    } catch {

        history = [];
    }


    history.push(data);


    if (history.length > 500) {
        history =
            history.slice(-500);
    }


    localStorage.setItem(
        key,
        JSON.stringify(history)
    );
}


/* =====================================================
   ADD FRIEND
===================================================== */

addFriendButton.addEventListener(
    "click",
    () => {

        openModal(
            "friendModal"
        );

        document
            .getElementById(
                "friendCodeInput"
            )
            .focus();
    }
);


document
    .getElementById("lookupButton")
    .addEventListener(
        "click",
        () => {

            const code =
                document
                    .getElementById(
                        "friendCodeInput"
                    )
                    .value
                    .trim()
                    .toUpperCase();

            if (!code) return;

            send({
                type: "lookup-user",
                code
            });
        }
    );


function showUserResult(
    user,
    online
) {

    const result =
        document.getElementById(
            "userResult"
        );

    result.classList.remove(
        "hidden"
    );


    setAvatar(
        document.getElementById(
            "resultAvatar"
        ),
        user.name,
        user.avatar
    );


    document.getElementById(
        "resultName"
    ).textContent =
        user.name;


    document.getElementById(
        "resultCode"
    ).textContent =
        user.code +
        (
            online
                ? " • Online"
                : " • Offline"
        );


    document
        .getElementById(
            "confirmAddFriend"
        )
        .onclick = () => {

            send({
                type: "add-friend",
                code: user.code
            });

            closeModal(
                "friendModal"
            );

            requestFriends();
        };
}


/* =====================================================
   PROFILE
===================================================== */

profileButton.addEventListener(
    "click",
    () => {

        updateProfileUI();

        openModal(
            "profileModal"
        );
    }
);


function updateProfileUI() {

    document.getElementById(
        "myCode"
    ).textContent =
        myCode || "--------";


    document.getElementById(
        "profileNameInput"
    ).value =
        myName;


    setAvatar(
        document.getElementById(
            "profileAvatar"
        ),
        myName,
        myAvatar
    );
}


document
    .getElementById(
        "saveProfileButton"
    )
    .addEventListener(
        "click",
        () => {

            const name =
                document
                    .getElementById(
                        "profileNameInput"
                    )
                    .value
                    .trim();

            if (!name) return;

            send({
                type: "update-profile",
                name,
                avatar: myAvatar
            });
        }
    );


document
    .getElementById(
        "copyCodeButton"
    )
    .addEventListener(
        "click",
        async () => {

            try {

                await navigator.clipboard.writeText(
                    myCode
                );

                setStatus(
                    document.getElementById(
                        "profileStatus"
                    ),
                    "Code copied!"
                );

            } catch {

                setStatus(
                    document.getElementById(
                        "profileStatus"
                    ),
                    "Copy failed."
                );
            }
        }
    );


/* =====================================================
   GROUP CREATION
===================================================== */

groupsTab.addEventListener(
    "click",
    () => {

        friendsList.classList.add(
            "hidden"
        );

        groupsList.classList.remove(
            "hidden"
        );

        createGroupButton.classList.remove(
            "hidden"
        );

        friendsTab.classList.remove(
            "active"
        );

        groupsTab.classList.add(
            "active"
        );

        requestGroups();
    }
);


friendsTab.addEventListener(
    "click",
    () => {

        groupsList.classList.add(
            "hidden"
        );

        friendsList.classList.remove(
            "hidden"
        );

        createGroupButton.classList.add(
            "hidden"
        );

        groupsTab.classList.remove(
            "active"
        );

        friendsTab.classList.add(
            "active"
        );

        requestFriends();
    }
);


createGroupButton.addEventListener(
    "click",
    () => {

        openModal(
            "groupModal"
        );

        document
            .getElementById(
                "groupNameInput"
            )
            .focus();
    }
);


document
    .getElementById(
        "confirmCreateGroup"
    )
    .addEventListener(
        "click",
        () => {

            const name =
                document
                    .getElementById(
                        "groupNameInput"
                    )
                    .value
                    .trim();

            if (!name) {

                setStatus(
                    document.getElementById(
                        "groupStatus"
                    ),
                    "Enter a group name."
                );

                return;
            }

            send({
                type: "create-group",
                name
            });
        }
    );


/* =====================================================
   CHAT DISPLAY
===================================================== */

function showChat() {

    emptyChat.classList.add(
        "hidden"
    );

    chatWindow.classList.remove(
        "hidden"
    );

    document.querySelector(
        ".sidebar"
    ).style.display =
        "";

    document.querySelector(
        ".chat"
    ).style.display =
        "";


    if (
        window.innerWidth <= 700
    ) {

        document.querySelector(
            ".sidebar"
        ).style.display =
            "none";

        document.querySelector(
            ".chat"
        ).style.display =
            "block";
    }

    messageInput.focus();
}


backButton.addEventListener(
    "click",
    () => {

        if (
            window.innerWidth <= 700
        ) {

            document.querySelector(
                ".sidebar"
            ).style.display =
                "flex";

            document.querySelector(
                ".chat"
            ).style.display =
                "none";
        }
    }
);


/* =====================================================
   CALLING
===================================================== */

let peerConnection = null;

let localStream = null;

let activeCall = false;


callButton.addEventListener(
    "click",
    startCall
);


async function startCall() {

    if (
        currentChatType !== "private"
    ) {
        alert(
            "Calls are currently available for private chats."
        );

        return;
    }


    try {

        localStream =
            await navigator.mediaDevices
                .getUserMedia({
                    audio: true,
                    video: true
                });


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


        const offer =
            await peerConnection
                .createOffer();


        await peerConnection
            .setLocalDescription(
                offer
            );


        openModal(
            "callModal"
        );


        document.getElementById(
            "callTitle"
        ).textContent =
            `Calling ${chatName.textContent}`;


        document.getElementById(
            "callStatus"
        ).textContent =
            "Calling...";


        document.getElementById(
            "localVideo"
        ).srcObject =
            localStream;


        send({
            type: "call-offer",
            to: currentChat,
            offer
        });

        activeCall = true;

    } catch (error) {

        console.error(error);

        alert(
            "Could not access your camera or microphone."
        );
    }
}


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
                event.candidate
            ) {

                send({
                    type:
                        "ice-candidate",
                    to:
                        currentChat,
                    candidate:
                        event.candidate
                });
            }
        };


    pc.ontrack =
        event => {

            const video =
                document.getElementById(
                    "remoteVideo"
                );

            video.srcObject =
                event.streams[0];
        };


    return pc;
}


async function handleCallSignal(data) {

    if (
        ![
            "call",
            "call-offer",
            "call-answer",
            "ice-candidate",
            "call-decline",
            "call-end"
        ].includes(data.type)
    ) {
        return;
    }


    if (
        data.type === "call-offer"
    ) {

        const accept =
            confirm(
                `${data.sender} is calling you. Accept?`
            );


        if (!accept) {

            send({
                type:
                    "call-decline",
                to:
                    data.from
            });

            return;
        }


        currentChat =
            data.from;

        currentChatType =
            "private";


        try {

            localStream =
                await navigator
                    .mediaDevices
                    .getUserMedia({
                        audio: true,
                        video: true
                    });


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


            await peerConnection
                .setRemoteDescription(
                    new RTCSessionDescription(
                        data.offer
                    )
                );


            const answer =
                await peerConnection
                    .createAnswer();


            await peerConnection
                .setLocalDescription(
                    answer
                );


            openModal(
                "callModal"
            );


            document.getElementById(
                "callTitle"
            ).textContent =
                `Call with ${data.sender}`;


            document.getElementById(
                "callStatus"
            ).textContent =
                "Connected";


            document.getElementById(
                "localVideo"
            ).srcObject =
                localStream;


            send({
                type:
                    "call-answer",
                to:
                    data.from,
                answer
            });


            activeCall = true;

        } catch (error) {

            console.error(error);

        }

        return;
    }


    if (
        data.type === "call-answer"
    ) {

        if (
            peerConnection
        ) {

            await peerConnection
                .setRemoteDescription(
                    new RTCSessionDescription(
                        data.answer
                    )
                );

            document.getElementById(
                "callStatus"
            ).textContent =
                "Connected";
        }

        return;
    }


    if (
        data.type === "ice-candidate"
    ) {

        if (
            peerConnection &&
            data.candidate
        ) {

            try {

                await peerConnection
                    .addIceCandidate(
                        new RTCIceCandidate(
                            data.candidate
                        )
                    );

            } catch (error) {

                console.error(error);
            }
        }

        return;
    }


    if (
        data.type === "call-decline"
    ) {

        endCall();

        alert(
            "The call was declined."
        );

        return;
    }


    if (
        data.type === "call-end"
    ) {

        endCall();

        return;
    }
}


/* =====================================================
   END CALL
===================================================== */

document
    .getElementById(
        "endCallButton"
    )
    .addEventListener(
        "click",
        () => {

            send({
                type: "call-end",
                to: currentChat
            });

            endCall();
        }
    );


function endCall() {

    activeCall = false;


    if (peerConnection) {

        peerConnection.close();

        peerConnection =
            null;
    }


    if (localStream) {

        localStream
            .getTracks()
            .forEach(
                track =>
                    track.stop()
            );

        localStream =
            null;
    }


    const local =
        document.getElementById(
            "localVideo"
        );

    const remote =
        document.getElementById(
            "remoteVideo"
        );


    local.srcObject =
        null;

    remote.srcObject =
        null;


    closeModal(
        "callModal"
    );
}


/* =====================================================
   UI HELPERS
===================================================== */

function openModal(id) {

    document
        .getElementById(id)
        .classList.remove(
            "hidden"
        );
}


function closeModal(id) {

    document
        .getElementById(id)
        .classList.add(
            "hidden"
        );
}


document
    .querySelectorAll(
        "[data-close]"
    )
    .forEach(button => {

        button.addEventListener(
            "click",
            () => {

                closeModal(
                    button.dataset.close
                );
            }
        );
    });


function setStatus(
    element,
    text
) {

    if (element) {
        element.textContent =
            text || "";
    }
}


function emptyList(text) {

    const element =
        document.createElement(
            "div"
        );

    element.style.padding =
        "20px";

    element.style.textAlign =
        "center";

    element.style.color =
        "#94a3b8";

    element.innerHTML =
        text;

    return element;
}


function createAvatar(
    name,
    avatar
) {

    const element =
        document.createElement(
            "div"
        );

    element.className =
        "avatar";

    setAvatar(
        element,
        name,
        avatar
    );

    return element;
}


function setAvatar(
    element,
    name,
    avatar
) {

    element.innerHTML = "";

    if (avatar) {

        const image =
            document.createElement(
                "img"
            );

        image.src =
            avatar;

        image.onerror =
            () => {

                element.innerHTML =
                    initials(name);
            };

        element.appendChild(
            image
        );

    } else {

        element.textContent =
            initials(name);
    }
}


function initials(name) {

    return String(
        name || "?"
    )
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(
            part =>
                part[0]
        )
        .join("")
        .toUpperCase();
}


function formatTime(time) {

    if (!time) {
        return "";
    }

    try {

        return new Date(time)
            .toLocaleTimeString(
                [],
                {
                    hour: "2-digit",
                    minute: "2-digit"
                }
            );

    } catch {

        return "";
    }
}


/* =====================================================
   SAVE RECEIVED/SENT PRIVATE MESSAGES
===================================================== */

const originalReceivePrivateMessage =
    receivePrivateMessage;


/*
 * Wrap the receiver so messages are
 * stored locally.
 */

receivePrivateMessage =
    function(data) {

        saveMessageLocally(data);

        originalReceivePrivateMessage(data);
    };


/* =====================================================
   STARTUP
===================================================== */

if (myCode && myName) {

    nameInput.value =
        myName;

    codeInput.value =
        myCode;

    setStatus(
        registerStatus,
        "Connecting..."
    );

    connect();

} else {

    registerScreen.classList.remove(
        "hidden"
    );

    mainScreen.classList.add(
        "hidden"
    );
}