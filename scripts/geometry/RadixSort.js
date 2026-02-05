// RadixSort
// mostly from https://jsben.ch/96YZc
// this version is nicely simple, but does another iteration through the array
// to find max: https://tylerewillis.com/page/radix-sort-javascript

/* test
arr = [1,3,3,4,2,1,3,7,20,99,42,41];
radixSortInt(arr)

arr = arr.map((elem, idx) => {
  return { idx, score: elem};
});
radixSortObj(arr, "score")

*/

export function radixSortObj(arr, scoreProp) {
  let maxNum = 0;
  let place = 10;
  let digit_counter = 0;
  const ln = arr.length;
  const buckets = [[], [], [], [], [], [], [], [], [], []];
  for ( let i = 0; i < ln; i += 1 ) {
    const num = arr[i][scoreProp];
    buckets[num % 10].push(arr[i]);
    maxNum = Math.max(num, maxNum);
  }
  const max = Math.log10(maxNum) | 0;
  arr = [].concat(...buckets);
  while ( digit_counter++ < max ) {
    const buckets = [[], [], [], [], [], [], [], [], [], []];
    for ( let i = 0; i < ln; i += 1 ) {
      const num = arr[i][scoreProp];
      buckets[(num / place | 0) % 10].push(arr[i]);
    }
    place *= 10;
    arr = [].concat(...buckets);
  }
  return arr;
}


export function radixSortInt(arr) {
  let maxNum = 0;
  let place = 10;
  let digit_counter = 0;
  const ln = arr.length;
  const buckets = [[], [], [], [], [], [], [], [], [], []];
  for ( let i = 0; i < ln; i += 1 ) {
    const num = arr[i];
    buckets[num % 10].push(num);
    maxNum = Math.max(num, maxNum);
  }
  const max = Math.log10(maxNum) | 0;
  arr = [].concat(...buckets);
  while ( digit_counter++ < max ) {
    const buckets = [[], [], [], [], [], [], [], [], [], []];
    for ( let i = 0; i < ln; i += 1 ) {
      const num = arr[i];
      buckets[(num / place | 0) % 10].push(num);
    }
    place *= 10;
    arr = [].concat(...buckets);
  }
  return arr;
}
