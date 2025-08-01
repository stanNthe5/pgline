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

This benchmark is comparing **pgline** to **postgresjs** and **node-postgres**. For each driver, it uses 3 worker threads, makes **100** queries per batch, and **100k** queries as total.
(Benchmark scripts is in the `benchmark` folder of this project.)

### Result
```
postgres
-----
Wall time: 1651.20 ms
CPU time: 3701.36 ms
Estimated CPU usage: 37.36%


pgline
-----
Wall time: 977.27 ms
CPU time: 1746.70 ms
Estimated CPU usage: 29.79%


pg
-----
Wall time: 2971.98 ms
CPU time: 6084.01 ms
Estimated CPU usage: 34.12%

```
