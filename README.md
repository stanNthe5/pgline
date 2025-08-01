# pgline
A PostgreSQL driver for Node.js written in TypeScript. It fully implements [Pipeline Mode](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html). Pgline delivers exceptionally high performance in concurrent queries. It offers faster speed and lower database CPU usage. 

## Install
```
npm i pgline
```

## Usage

### Connect and Query
```
import  pgline  from 'pgline';
let client = await pgline('postgresql://postgres:postgres@localhost:5432/someDb')
let res = await client.query("select * from posts where id=$1", [123]);
console.log(res.rows)
```
### Transaction
```
let txRes = await client.begin([
    { text: "update posts set title=$1 where id=$2", values: [123,'abc'] },
    { text: "insert into posts(title) values($1)", values: ['abc'] },
])
```

## Benchmark

This benchmark is comparing **pgline** to **Bun sql**, **postgresjs** and **node-postgres**. For each driver, it uses 3 worker threads, makes **100** queries per batch, and **100k** queries as total.
(Benchmark scripts is in the `benchmark` folder of this project.)

### Result
```
bun sql
-----
Wall time: 1472.29 ms
CPU time: 2770.74 ms
Estimated CPU usage: 31.37%


postgres
-----
Wall time: 1549.65 ms
CPU time: 3486.67 ms
Estimated CPU usage: 37.50%


pgline
-----
Wall time: 847.06 ms
CPU time: 1522.07 ms
Estimated CPU usage: 29.95%


pg
-----
Wall time: 3130.38 ms
CPU time: 6573.17 ms
Estimated CPU usage: 35.00%

```
