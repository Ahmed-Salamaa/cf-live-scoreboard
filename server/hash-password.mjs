import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { hashPassword } from './auth.mjs'

let password = process.argv[2]
if (!password) {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  password = await rl.question('Enter admin password to hash: ')
  rl.close()
}

if (!password) {
  console.error('Error: password cannot be empty.')
  process.exit(1)
}

console.log('\nAdd this to .env or Vercel Environment Variables:\n')
console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}\n`)
