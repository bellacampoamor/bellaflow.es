// npm run seed:sql: schrijft de voorbeeldgegevens naar supabase/seed.sql
import { writeFileSync } from 'node:fs'
import { loadSnapshot } from '../src/data/driver'
import { LocalDriver } from '../src/data/localDriver'
import { seedDemo } from '../src/domain/demo'
import { toSeedSql } from './seed-sql'

const db = new LocalDriver(false)
await seedDemo(db)
writeFileSync('supabase/seed.sql', `-- Verzonnen voorbeeldgegevens, alleen voor test en demo.\n${toSeedSql(await loadSnapshot(db))}`)
console.log('supabase/seed.sql geschreven')
