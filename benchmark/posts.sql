CREATE TABLE posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);

INSERT INTO posts (id, title, body)
SELECT i, 'Title ' || i, 'This is the body of post ' || i
FROM generate_series(1, 100) AS i;