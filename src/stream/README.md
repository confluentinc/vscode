# MTA: Message Tracking Algorithm

Not to be confused with [MTA](https://en.wikipedia.org/wiki/Metropolitan_Transportation_Authority).

For more information please read [the design doc](https://confluentinc.atlassian.net/wiki/x/hoCF0w).

## Problem

Apache Kafka is not a database. One cannot simply query messages from a topic by providing multiple
params that describe target messages' internal properties. A topic does not have an index that would
speed up lookups and there’s no extra computing resources dedicated for executing these queries at
all. One can start consuming records (either new ones or those that still retained) and then apply
an arbitrary tool to cleanup/filter/search through the data. One may possibly use Apache Flink, if
they have advanced experience and computing resources for the task. For certain large volumes of
messages (or depending on a message size) Apache Flink most likely is the tool for the job. But for
many use cases it only comes with high level of effort required to get the desired results.

This is where web UI based message viewers start to shine: they help establishing short feedback
loop for exploring streams of data. They allow looking into a stream of messages without requiring
extra resources or writing SQL code. From there, allowing basic filtering, search, and summarized
insights will be just enough for the user to get a result they’re looking for: verify that necessary
data exists or doesn’t exist in the new messages, observe data patterns w.r.t. partition or time
frames, etc.

Multiple existing data management libraries (including our DIVA) focus on batch processing of large
chunks of data. The optimizations they apply often may not be suitable for constantly growing
dataset that may be updating every couple of seconds. There is a need for new data structures that
can provide the same performance and flexibility for filtering and searching while making sure the
browser can handle the incoming stream of data without excessive resources consumption.

## Skip List

The core data structure of MTA is [Skip List](https://en.wikipedia.org/wiki/Skip_list). It is used
for tracking stream of values in particular order so we can apply filters and aggregations
efficiently. The implementation is highly specific to accomodate the original design of JavaScript
memory model.

_Design details TBD_

## Memory Address System

Following example covers the idea behind special memory address system used by the skip list
implementation. When used with typed arrays instead of object references it provides top notch
performance.

Let's say you have an array of arbitrary values:

```js
let letters = ["A", "B", "C", "D", "E", "F"];
```

To access values in the array indices are used: unsigned integers that define the offset from the
beginning of the list the code should skip to find the target item:

```js
letters[0] == "A";
letters[1] == "B";
letters[3] == "D";
```

An array can contain not just characters, but also numbers:

```js
let numbers = [0, 1, 2, 3, 4, 5];
```

And these numbers can also be access by the same indices:

```js
numbers[0] == 0;
numbers[1] == 1;
numbers[3] == 3;
```

Since the values here are numbers, they can also be used as indices. In this example, an index (as a
number) happened to be equal to the numeric value that's being accessed:

```js
numbers[1] == 1;
numbers[numbers[1]] == 1;
numbers[numbers[numbers[1]]] == 1;
```

This may not be particularly useful by itself, but it shows important property of indices. Let's say
the `numbers` array is shifted by one:

```js
let numbers = [1, 2, 3, 4, 5, 6];
```

And so each value by index going to be shifted by one comparing to its index:

```js
numbers[0] == 1;
numbers[1] == 2;
numbers[3] == 4;
```

This means that accessed by index values happen to be equal to an index of another item. So reusing
the value as an index keeps giving another item in the array:

```js
numbers[0] == 1;
numbers[numbers[0]] == 2;
numbers[numbers[numbers[0]]] == 3;
```

Even more, these values can now be accessed in a cycle:

```js
let index = 0;
while (index < numbers.length) {
  console.log("index", index, "value", numbers[index]);
  index = numbers[index];
}

// index 0 value 1
// index 1 value 2
// index 2 value 3
// index 3 value 4
// index 4 value 5
// index 5 value 6
```

Indices are the same for different arrays. So while `index` in previous example moves by values from
`numbers`, it can also be used to access values from `letters` at the same time. Also a more
familiar array traversal cycle can be applied:

```js
//   start from 0;  while index in bounds;  iterate by reading numbers array
for (let index = 0; index < numbers.length; index = numbers[index]) {
  console.log(letters[index]);
}

// A B C D E F
```

We can wrap this logic in a function, and provide multiple different indices orders for the same
values, or different values for the same indices:

```js
function follow(values, indices, start) {
  let result = [];
  for (let index = start; index < indices.length; index = indices[index]) {
    result.push(values[index]);
  }
  return result;
}

follow(letters, [1, 2, 3, 4, 5, 6], 0); // A B C D E F
follow(letters, [6, 0, 1, 2, 3, 4], 5); // F E D C B A
```

The second usage example may look odd as the numbers are not in natural order since `6` is at the
beginning. Following from index `5` as a starting point, and moving one index down in the list, we
need a termination point to stop the traversal cycle. The size of array is used since it fits the
condition `index < indices.length`.

But since we now also rely on another array to get values from, we can target its length to know
exactly how many iterations it takes to traverse the whole array:

```js
function follow(values, indices, start) {
  let result = [];
  let index = start;
  // a lot more familiar line of code, isn't it?
  for (let i = 0; i < values.length; i++) {
    result.push(values[index]);
    index = indices[index];
  }
  return result;
}

follow(letters, [1, 2, 3, 4, 5, null], 0); // A B C D E F
follow(letters, [null, 0, 1, 2, 3, 4], 5); // F E D C B A
```

We still need some sentinels here to ensure the size of the array. The numbers array still needs to
match values length so the indices align. But now that we iterate exact number of times, those extra
values will never be used so they can contain any value, zero, or any sort of sentinel.

Now these two examples have numbers in natural order and by shifting them or changing the starting
point we get different result outputs. Let's try setting up some other arbitrary order of values by
manipulating these indices.

```js
let forward = [];

forward[0] = 4; // A -> E
forward[4] = 1; // E -> B
forward[1] = 3; // B -> D
forward[3] = 5; // D -> F
forward[5] = 2; // F -> C
forward[2] = null;

// here's how the resulting array looks like
deepEqual(forward, [4, 3, null, 5, 1, 2]);

follow(letters, forward, 0); // A E B D F C
```

In the example above you can see how we only need to set a single relation at the time. At this
point, we implemented a naive version of singly-linked list: there's a head element and a set of
`next` references. You can compare it to a more familiar implementation of linked list:

```js
let node = { index: 0, next: null };
let head = node;
node.next = node = { index: 4, next: null };
node.next = node = { index: 1, next: null };
node.next = node = { index: 3, next: null };
node.next = node = { index: 5, next: null };
node.next = node = { index: 2, next: null };
node.next = node = { index: null, next: null };

let cursor = head;
while (cursor != null) {
  console.log(letters[cursor.index]); // A E B D F C
  cursor = cursor.next;
}
```

Most importantly, we implemented that linked list as a separate data structure, without interfering
with the original data we want to reorder. This means we can make multiple linked lists for the same
set of records, e.g. for representing different orders for unique metrics.

A seasoned JavaScript engineer may notice that using arrays for referencing other values may not be
that different from using object-based linked lists. JavaScript's arrays are still objects and its
values are stored on heap. Modern engines do their best to optimize arrays but certain decades
backward compatiblity-related things ensure the arrays have suboptimal performance.

The solution is to keep using plain arrays for actual values, but encode `forward` array as
[typed array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Typed_arrays). The
values (e.g. `letters`) may be of variety of types, but the pointers establishing their order always
going to be numbers.

```js
let letters = ["A", "B", "C", "D", "E"];
let forward = new Uint8Array(5); // Initialized as [0, 0, 0, 0, 0]
forward[0] = 1;
forward[1] = 2;
forward[2] = 3;
forward[3] = 4;

deepEqual(forward, [1, 2, 3, 4, 0]);

follow(letters, forward, 0); // A B C D E
```

It may look like we have a wrong connection there at the end, where `forward[4] == 0`, and based on
the previous examples it suppose to be a `null` reference. But `null` cannot be encoded in typed
array, and the default (unset) value is `0`. However, the `follow()` method remains correct since it
relies on the values array's length to avoid doing extra iterations.

Let's talk about essential operations: inserting and removing nodes dynamically, i.e. outside of the
initialization step.

Can we still do it with the array of numbers that has fixed length? The presented system certainly
shines in environment where the top size boundary is known in advance. Arguably, the one should
always be defined explicitly for clarity. Surely we should not be allocating 40GB of memory for the
pointer system when the app is loaded to cover all possible cases. This example considers small
numbers of values. It is still possible to grow typed arrays after their creation, but let's focus
on the pointers system first.

Let's start with a familiar array of letters that is out of order and now it also misses the letter
`C`. Once we identify the connections of letters to align them in alphabetical order, we need to
find where the missing letter should be placed in the sequence of pointers.

```js
let letters = ["A", "D", "E", "B", "F"];

let forward = new Uint8Array(6); // [0, 0, 0, 0, 0, 0]
forward[0] = 3; // A -> B
forward[3] = 1; // B -> D
forward[1] = 2; // D -> E
forward[2] = 4; // E -> F

let head = 0;

deepEqual(forward, [3, 2, 4, 1, 0, 0]);
follow(letters, forward, head); // A B D E F
```

To keep track of the value itself, we _push_ it to the `letters` array. No, we don't `splice` it in
certain place, we just keep it at the end. This new value added creates the new index that we'll use
as a pointer.

```js
// push() returns new length, so -1 gives the index of inserted item
let index = letters.push("C") - 1; // 5
```

The benefit of linked list is its $O(1)$ insertion time complexity. Well, when you already know the
node the new value follows. In our example we need to find that node, specifically the one which
value is the first to follow the new value in established order. It gonna sound like $O(n)$ about to
happen, but the rest of skip list complexity is designed to make it $O(log n)$, I promise. For this
example, we follow the basics.

```js
// starting from the head of the list
let cursor = head;
// we gonna also keep the reference to cursor, before stepping forward
let prev;
// cycle's iteration limit is the previous array's length
for (let i = 0; i < letters.length - 1; i++) {
  // C < A == false, C < B == false, C < D == true
  if (letters[index] < letters[cursor]) {
    // previous node's next node is the item we insert
    forward[prev] = index;
    // the target item's next node is the one we found
    forward[index] = cursor;
  } else {
    // keeping track of the value we just tested,
    // it will be the node on the left of the target
    prev = cursor;
    // following the pointers to get to the next item
    cursor = forward[cursor];
  }
}
```

So here we started iterating over pointers, comparing the value of each item in order to the value
that was just inserted to the end of the array (`letter[index]`, which is `C`). As we got to the
item `D`, we get in the first branch of the code inside the cycle. There we wire up two nodes to
maintain the established order of values: `B`'s next item is going to be `C` and `C`'s next item is
going to be `D`.

```js
deepEqual(forward, [3, 2, 4, 5, 0, 1]);

follow(letters, forward, 0); // A B C D E F
```

It may feel like that cycle above is highly specific for the insertion points being somewhere after
the head item. To add items before the head item we may need an extra check _before_ the cycle, so
we can also update the `head` variable. Similarly, in more practical implementation we'll need a
check for the `tail`, if the new item can be put to the end of the list.

To reiterate the result in a simpler form, this is how the pointers in the insertion example look
like:

```js
letters[head] == "A";
letters[forward[head]] == "B";
letters[forward[forward[head]]] == "C";
letters[forward[forward[forward[head]]]] == "D";
letters[forward[forward[forward[forward[head]]]]] == "E";
letters[forward[forward[forward[forward[forward[head]]]]]] == "F";
```

The removal operation may be a bit tricky in this system. In practice, the removing an item from the
linked list going to happen when a message in a stream needs to be removed because we reached
circular buffer capacity. It will be replaced in the array of values, so the index of the new item
is going to be matching the one we already have somewhere in the linked list. So we gotta remove it
from there first, and then it will be inserted back in the right position for the new value.

When it comes to this example, the removal of a pointer is going to be quite straightforward:
iterate over the items, and if an item's forward pointer is the index we need to remove, make this
item point to the item that follows: `forward[cursor] = forward[forward[cursor]]`.
