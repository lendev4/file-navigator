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
function hello(name) {
  return `Hello, ${name}!`;
}
```

## An image

![Photo 1](photo1.png)

## Raw HTML

<details><summary>Click to expand</summary>Hidden content.</details>

<script>document.title = 'SCRIPT RAN'</script>
<img src="nope.png" onerror="document.title = 'ONERROR RAN'">

---

The end.
