# Markdown guide

A test file for the Markdown viewer. Jump to [the table](#a-table) or go back to the [readme](readme.md).

## Text

Some **bold**, some *italic*, some `inline code` and a [web link](https://example.com).
A link to [notes.txt](notes.txt), to [a subfolder](subfolder/) and to [the CSV](table.csv).

> A quote, spanning
> two lines.

## Lists

- First item
- Second item
  - Nested item
1. One
2. Two

- [x] Done task
- [ ] Open task

## A table

| File | Kind | Size |
|---|---|---:|
| photo1.png | image | 1.1 kB |
| notes.txt | text | 70 B |

## Code

```js
// Greets someone.
function hello(name) {
  const count = 3;
  return `Hello, ${name}! x${count}`;
}
```

```python
def area(radius: float) -> float:
    """Area of a circle."""
    return 3.14159 * radius ** 2  # good enough
```

```bash
for f in *.md; do echo "Found $f"; done
```

```diff
- old line
+ new line
```

A block without a language, and one in a language highlight.js doesn't know, stay plain:

```
plain text block
```

```klingon
qaStaH nuq?
```

## An image

![Photo 1](photo1.png)

## Raw HTML

<details><summary>Click to expand</summary>Hidden content.</details>

<script>document.title = 'SCRIPT RAN'</script>
<img src="nope.png" onerror="document.title = 'ONERROR RAN'">

---

The end.
