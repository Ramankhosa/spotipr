import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

const existingKeys = new Set(Object.keys(process.env))
const merged: Record<string, string> = {}

for (const name of ['.env', `.env.${process.env.NODE_ENV || 'development'}`, '.env.local', `.env.${process.env.NODE_ENV || 'development'}.local`]) {
  const filePath = path.join(process.cwd(), name)
  if (!fs.existsSync(filePath)) continue
  Object.assign(merged, dotenv.parse(fs.readFileSync(filePath)))
}

for (const [key, value] of Object.entries(merged)) {
  if (!existingKeys.has(key)) process.env[key] = value
}
