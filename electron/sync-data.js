const fs = require('fs')
const path = require('path')

const unpacked = path.join(__dirname, '..', 'dist', 'win-unpacked')
const source = path.join(__dirname, '..')
const files = ['emotes.json', 'song_tags.json', 'song_ratings.json']

files.forEach(file => {
  const from = path.join(unpacked, file)
  const to = path.join(source, file)
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, to)
    console.log(`Synced: ${file}`)
  }
})
