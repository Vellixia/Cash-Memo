CREATE TABLE cashmemo_schema_identity (
    product TEXT PRIMARY KEY,
    generation TEXT NOT NULL,
    CHECK (product = 'cashmemo'),
    CHECK (generation = 'v1')
);

INSERT INTO cashmemo_schema_identity (product, generation)
VALUES ('cashmemo', 'v1');
