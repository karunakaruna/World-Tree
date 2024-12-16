const http = require("http");
const express = require("express");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");
const fs = require('fs');
const path = require('path');
const csv = require('csv');

const app = express();
app.use(express.static("public"));

const serverPort = process.env.PORT || 3000;
const server = http.createServer(app);

// File paths for data persistence
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.csv');

// Create data directory if it doesn't exist
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Error logging
const logError = (error, context = '') => {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${context}: ${error.stack || error}\n`;
    fs.appendFileSync(path.join(DATA_DIR, 'error.log'), logMessage);
    console.error(logMessage);
    broadcastServerLog(`${context}: ${error.message || error}`, 'error');
};

// Function to broadcast server logs to dashboard
const broadcastToAll = (message) => {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
};

const broadcastServerLog = (message, logType = 'info') => {
    broadcastToAll({
        type: 'serverlog',
        message,
        logType
    });
};

// Load users from CSV file
const loadUsers = () => {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const content = fs.readFileSync(USERS_FILE, 'utf-8');
            if (!content.trim()) return new Map();
            const records = csv.parse(content, { columns: true });
            return records.reduce((acc, record) => {
                acc.set(record.id, {
                    ...record,
                    listeningTo: JSON.parse(record.listeningTo || '[]'),
                    afk: record.afk === 'true',
                });
                return acc;
            }, new Map());
        }
    } catch (error) {
        logError(error, 'Loading users failed');
    }
    return new Map();
};

// Track last save time
let lastSaveTime = new Date('2024-12-15T20:45:40-08:00').getTime();

// Save users to CSV file
function saveToCSV() {
    try {
        const userArray = Array.from(users.values()).map(user => ({
            ...user,
            listeningTo: JSON.stringify(user.listeningTo),
        }));
        
        csv.stringify(userArray, { header: true }, (err, output) => {
            if (err) throw err;
            fs.writeFileSync(USERS_FILE, output);
            lastSaveTime = Date.now();
            broadcastToAll({
                type: 'saveTime',
                timestamp: lastSaveTime
            });
            broadcastServerLog('Data saved to CSV');
        });
    } catch (error) {
        logError(error, 'Saving users failed');
    }
};

// Function to broadcast user updates
function broadcastUserUpdate() {
    const activeUsers = Array.from(users.values())
        .map(user => ({
            id: user.id,
            username: user.username || `User_${user.id.slice(0, 5)}`,
            tx: user.tx || 0,
            ty: user.ty || 0,
            tz: user.tz || 0,
            description: user.description || '',
            listeningTo: user.listeningTo || [],
            afk: user.afk || false
        }));
    
    broadcastToAll({
        type: 'userupdate',
        users: activeUsers,
        lastSaveTime
    });
};

// In-memory storage for user metadata and WebSocket clients
const users = new Map();
const clientMap = new Map();
let numUsers = 0;

// Efficient client lookup using a Map

// Attach WebSocket server
const wss = new WebSocket.Server({ server });

server.listen(serverPort, () => {
    console.log(`Server started on port ${serverPort}`);
});

// WebSocket connection handler
wss.on('connection', (ws) => {
    try {
        const userId = uuidv4();
        ws.id = userId;
        
        // Initialize user with default values
        const defaultUser = {
            id: userId,
            username: `User_${userId.slice(0, 5)}`,
            tx: 0, ty: 0, tz: 0,
            listeningTo: [],
            afk: false,
            description: ''
        };
        
        users.set(userId, defaultUser);
        broadcastUserUpdate();

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                
                if (data.type === 'identify' && data.client === 'dashboard') {
                    broadcastServerLog('Dashboard connected');
                    return;
                }

                if (data.type === 'usercoordinate') {
                    const user = users.get(ws.id);
                    if (user) {
                        user.tx = data.coordinates.tx;
                        user.ty = data.coordinates.ty;
                        user.tz = data.coordinates.tz;
                        
                        broadcastToAll({
                            type: 'usercoordinateupdate',
                            from: ws.id,
                            coordinates: {
                                tx: user.tx,
                                ty: user.ty,
                                tz: user.tz
                            }
                        });
                    }
                } else if (data.type === 'updatemetadata') {
                    const user = users.get(ws.id);
                    if (user) {
                        if (data.username) {
                            user.username = data.username;
                        }
                        if (data.afk !== undefined) {
                            user.afk = data.afk;
                        }
                        broadcastUserUpdate();
                    }
                } else if (data.type === 'updatelisteningto') {
                    console.log(`User ${ws.id} updating listening list to:`, data.newListeningTo);

                    if (Array.isArray(data.newListeningTo)) {
                        if (users.get(ws.id)) {
                            const filteredListeningTo = data.newListeningTo.filter(
                                (listeningId) => listeningId !== ws.id
                            );

                            if (
                                JSON.stringify(users.get(ws.id).listeningTo) ===
                                JSON.stringify(filteredListeningTo)
                            ) {
                                console.log(`No change in listeningTo for user ${ws.id}.`);
                                return;
                            }

                            users.get(ws.id).listeningTo = filteredListeningTo;

                            console.log(
                                `Updated listeningTo for user ${ws.id} (filtered):`,
                                users.get(ws.id).listeningTo
                            );

                            broadcastUserUpdate();
                        } else {
                            console.error(`User ${ws.id} not found for listeningTo update.`);
                        }
                    } else {
                        console.error(
                            `Invalid listeningTo data from user ${ws.id}:`,
                            data.newListeningTo
                        );
                    }
                } else if (data.type === 'clearlist') {
                    console.log(`Clearing listening list for user: ${ws.id}`);
                    if (users.get(ws.id)) {
                        users.get(ws.id).listeningTo = [];
                        broadcastUserUpdate();
                    } else {
                        console.error(`User ${ws.id} not found for clearlist.`);
                    }
                } else if (data.type === 'data') {
                    const { data: payload } = message;

                    if (payload) {
                        // Iterate through all users to find who is listening to the sender (ws.id)
                        users.forEach((user, recipientId) => {
                            if (
                                Array.isArray(user.listeningTo) &&
                                user.listeningTo.includes(ws.id)
                            ) {
                                const recipientClient = clientMap.get(recipientId);

                                if (recipientClient && recipientClient.readyState === WebSocket.OPEN) {
                                    recipientClient.send(
                                        JSON.stringify({
                                            type: "data",
                                            from: ws.id,
                                            data: payload,
                                        })
                                    );
                                    // console.log(`Data sent from user ${ws.id} to ${recipientId}:`, payload);
                                } else {
                                    console.warn(
                                        `Recipient ${recipientId} not found or not connected for data message from user ${ws.id}.`
                                    );
                                }
                            }
                        });
                    } else {
                        console.error(
                            `Invalid data payload for user ${ws.id}:`,
                            payload
                        );
                    }
                } else if (data.type === 'update') {
                    const user = users.get(ws.id);
                    if (user) {
                        Object.assign(user, {
                            username: data.username || user.username,
                            tx: data.tx !== undefined ? data.tx : user.tx,
                            ty: data.ty !== undefined ? data.ty : user.ty,
                            tz: data.tz !== undefined ? data.tz : user.tz,
                            listeningTo: data.listeningTo || user.listeningTo,
                            afk: data.afk !== undefined ? data.afk : user.afk
                        });
                        
                        // Broadcast position update separately for real-time updates
                        if (data.tx !== undefined || data.ty !== undefined || data.tz !== undefined) {
                            broadcastToAll({
                                type: 'usercoordinateupdate',
                                from: ws.id,
                                coordinates: {
                                    tx: user.tx,
                                    ty: user.ty,
                                    tz: user.tz
                                }
                            });
                        }
                        broadcastUserUpdate();
                    }
                }
                // Log all non-ping messages to dashboard
                if (data.type !== 'ping' && data.type !== 'pong') {
                    broadcastServerLog(`Received ${data.type} message from ${ws.id || 'unknown user'}`);
                }
            } catch (error) {
                logError(error, 'Message handler failed');
            }
        });

        ws.on('close', () => {
            try {
                if (ws.id) {
                    console.log(`User disconnected: ${ws.id}`);
                    broadcastServerLog(`User disconnected: ${ws.id}`);
                    users.delete(ws.id);
                    clientMap.delete(ws.id);
                    numUsers = Math.max(0, numUsers - 1);
                    broadcastUserUpdate();
                    saveToCSV();
                }
            } catch (error) {
                logError(error, 'Connection close handler failed');
            }
        });

        console.log(`User connected: ${userId}`);
        broadcastServerLog(`User connected: ${userId}`);
        numUsers++;

        ws.send(
            JSON.stringify({
                type: "welcome",
                id: userId,
            })
        );
    } catch (error) {
        logError(error, 'Connection handler failed');
    }
});

// Handle server errors
server.on('error', (error) => {
    logError(error, 'Server error');
});

process.on('uncaughtException', (error) => {
    logError(error, 'Uncaught exception');
});

process.on('unhandledRejection', (error) => {
    logError(error, 'Unhandled rejection');
});

// Load existing users on startup
users = loadUsers();
numUsers = users.size;

// Start the ping heartbeat and periodic save
const startHeartbeat = () => {
    setInterval(() => {
        const currentTime = new Date().toISOString();
        console.log(`[PING HEARTBEAT] Time: ${currentTime}, Connected Users: ${numUsers}`);

        users.forEach((user) => {
            console.log(`User ${user.username} (${user.id}) is listening to:`, user.listeningTo);
        });

        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(
                    JSON.stringify({
                        type: "ping",
                        time: currentTime,
                        numUsers,
                    })
                );
            }
        });
    }, 5000);
};

const startPeriodicSave = () => {
    setInterval(() => {
        try {
            saveToCSV();
        } catch (error) {
            logError(error, 'Periodic save failed');
        }
    }, 30000); // Save every 30 seconds
};

startHeartbeat();
startPeriodicSave();

// Express route for debugging
app.get("/", (req, res) => {
    res.send(`
        <html>
            <head><title>Server Status</title></head>
            <body>
                <h1>Server Status</h1>
                <p>Number of connected users: ${numUsers}</p>
                <pre>${JSON.stringify(Array.from(users.values()), null, 2)}</pre>
            </body>
        </html>
    `);
});
