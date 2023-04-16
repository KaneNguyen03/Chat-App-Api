const express = require('express')
const mongoose = require('mongoose')
const dotenv = require('dotenv')
const port = 4000

dotenv.config()
mongoose.connect(process.env.MONGO_URL)

const app = express()

app.get('/', (req, res) => {
    res.json('test oke')
})

app.post('/register ', (req, res) => {

})

app.listen(port, () => console.log(`listening on port ${port} at http://localhost:${port}`))