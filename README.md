# pgline
A PostgreSQL driver for Node.js written in TypeScript. It fully implements [Pipeline Mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html). 

## Install
```
npm i pgline
```

## Usage
```
import { pgline } from 'pgline';
let client = await pgline('postgresql://postgres:postgres@localhost:5432/someDb')
let res = await client.query("select * from posts where id=$1", [id]);
console.log(res.rows[0])
```

## Performance

pgline delivers exceptionally high performance in concurrent queries. Among the database drivers I’m familiar with (pg, postgres, bun.sql), it offers faster speed and lower database CPU usage. This is mainly attributed to the deep utilization of pipeline mode and the optimization of the message-sending mechanism.

For testing, I installed PostgresSQL 17 On a 2-vcpu aws micro instance, and make simple requests from another instance. The result is 60,000 queries per second while the CPU usage of database instance is less than 50%.

### How did I make the testing?
Start a http server and send 20 queries per request.
```
http.createServer(async function (req, res) {
  let text = ''
    for (let id of ids) {
        let r = await client.query('select title from posts where id=$1;', [id])
        if (r.rows.length) {
          text += r.rows[0].title
        }
    }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.write(text);
  res.end();
}).listen(3000);
```
Send concurrent request to the server.(Apache HTTP server benchmarking tool)
```
ab -n 20000 -c 150  http://localhost:3000/

```
