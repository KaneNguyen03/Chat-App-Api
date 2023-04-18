const express = require('express')
const mongoose = require('mongoose')
const dotenv = require('dotenv')
const jwt = require('jsonwebtoken')
const cors = require('cors')
const bcrypt = require('bcryptjs')
const User = require('./models/User')
const cookieParser = require('cookie-parser')
const Message = require('./models/Message')
const ws = require('ws')
const fs = require('fs')

dotenv.config()

mongoose.connect(process.env.MONGO_URL)

const jwtSecret = process.env.JWT_SECRET
const bcryptSalt = bcrypt.genSaltSync(10)
const port = process.env.URL_PORT

const app = express()
app.use(express.json())
app.use('/uploads', express.static(__dirname + '/uploads'))
app.use(cookieParser())
app.use(cors({
    credentials: true,
    origin: ['https://chat-app-client-nu.vercel.app', 'http://localhost:5173']
}))

async function getUserDataFromRequest(req) {
    return new Promise((resolve, reject) => {
        const token = req.cookies?.token
        if (token) {
            jwt.verify(token, jwtSecret, {}, (err, userData) => {
                if (err) throw err
                resolve(userData)
            })
        } else {
            reject('no token')
        }
    })
}

app.get('/test', (req, res) => {
    res.json('test ok')
})

app.get('/profile', (req, res) => {
    console.log("🚀 Kha ne ~ file: index.js:50 ~ req:", req)
    const token = req.cookies?.token

    if (token) {
        jwt.verify(token, jwtSecret, {}, (err, userData) => {
            if (err) throw err
            res.json(userData)
        })
    } else {
        res.status(401).json('no token')
    }
})

app.get('/messages/:userId', async (req, res) => {
    const { userId } = req.params
    const userData = await getUserDataFromRequest(req)
    const ourUserId = userData.userId
    const messages = await Message.find({
        sender: { $in: [userId, ourUserId] },
        recipient: { $in: [userId, ourUserId] },
    }).sort({ createdAt: 1 })
    res.json(messages)
})

app.post('/register', async (req, res) => {
    const { username, password } = req.body
    try {
        const hashPassword = bcrypt.hashSync(password, bcryptSalt)
        const createdUser = await User.create({
            username: username,
            password: hashPassword
        })
        jwt.sign({ userId: createdUser._id, username }, jwtSecret, {}, (err, token) => {
            if (err) throw err
            res.cookie('token', token, { sameSite: 'none', secure: true }).status(201).json({
                id: createdUser._id,
            })
        })
    } catch (err) {
        console.log(err)
        res.status(500).json('error')
    }

})

app.post('/login', async (req, res) => {
    const { username, password } = req.body
    const foundUser = await User.findOne({ username })
    if (foundUser) {
        const passOk = bcrypt.compareSync(password, foundUser.password)
        if (passOk) {
            jwt.sign({ userId: foundUser._id, username }, jwtSecret, {}, (err, token) => {
                res.cookie('token', token, { sameSite: 'none', secure: true }).json({
                    id: foundUser._id,
                })
            })
        }
    }
})

app.get('/people', async (req, res) => {
    const users = await User.find({}, { '_id': 1, username: 1 })
    res.json(users)
})

app.post('/logout', (req, res) => {
    res.cookie('token', '', { sameSite: 'none', secure: true }).json('ok')
})

const server = app.listen(port, () => console.log(`listening on port ${port} at http://localhost:${port}`))

const wss = new ws.WebSocketServer({ server })

wss.on('connection', (connection, req) => {
    const cookies = req.headers.cookie
    if (cookies) {
        const tokenCookieString = cookies.split(';').find(str => str.startsWith("token="))
        if (tokenCookieString) {
            const token = tokenCookieString.split('=')[1]
            if (token) {
                jwt.verify(token, jwtSecret, {}, (err, userData) => {
                    if (err) throw err
                    const { userId, username } = userData
                    connection.userId = userId
                    connection.username = username
                })
            }
        }
    }

    [...wss.clients].forEach(client => {
        client.send(JSON.stringify({
            online: [...wss.clients].map(c => ({ userId: c.userId, username: c.username }))
        }))
    })

    function notifyAboutOnlinePeople() {
        [...wss.clients].forEach(client => {
            client.send(JSON.stringify({
                online: [...wss.clients].map(c => ({ userId: c.userId, username: c.username })),
            }))
        })
    }

    connection.isAlive = true

    connection.timer = setInterval(() => {
        connection.ping()
        connection.deathTimer = setTimeout(() => {
            connection.isAlive = false
            clearInterval(connection.timer)
            connection.terminate()
            notifyAboutOnlinePeople()
            console.log('dead')
        }, 1000)
    }, 5000)

    connection.on('pong', () => {
        clearTimeout(connection.deathTimer)
    })

    connection.on('message', async (message) => {
        const messageData = JSON.parse(message.toString())
        const { recipient, text, file } = messageData
        let filename = null
        if (file) {
            console.log('size', file.data.length)
            const parts = file.name.split('.')
            const ext = parts[parts.length - 1]
            filename = Date.now() + '.' + ext
            const path = __dirname + '/uploads/' + filename
            const bufferData = new Buffer(file.data.split(',')[1], 'base64')
            fs.writeFile(path, bufferData, () => {
                console.log('file saved:' + path)
            })
        }
        if (recipient && (text || file)) {
            const messageDoc = await Message.create({
                sender: connection.userId,
                recipient,
                text,
                file: file ? filename : null,
            })
            console.log('created message');
            [...wss.clients]
                .filter(c => c.userId === recipient)
                .forEach(c => c.send(JSON.stringify({
                    text,
                    sender: connection.userId,
                    recipient,
                    file: file ? filename : null,
                    _id: messageDoc._id,
                })))
        }
    })
    notifyAboutOnlinePeople()
})

