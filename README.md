# pgline
A PostgreSQL driver for Node.js written in TypeScript. It fully implements [Pipeline Mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html). 

## Install
```
npm i pgline
```

## Usage
```
import { pgline } from 'pgline';
let client = await pgline('postgresql://stan:stan@localhost:5432/sns')
let res = await client.query("select * from posts where id=$1", [id]);
console.log(res.rows[0])
```

## Performance

pgline delivers exceptionally high performance in concurrent queries. Among the database drivers I’m familiar with (pg, postgres, bun.sql), it offers faster speed and lower database CPU usage. This is mainly attributed to the deep utilization of pipeline mode and the optimization of the message-sending mechanism.
