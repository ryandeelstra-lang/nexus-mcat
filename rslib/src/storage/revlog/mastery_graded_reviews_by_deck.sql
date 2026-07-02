SELECT CASE
    WHEN c.odid == 0 THEN c.did
    ELSE c.odid
  END AS deck,
  COUNT(*) AS cnt
FROM revlog AS r
  JOIN cards AS c ON r.cid = c.id
WHERE c.id IN (
    SELECT cid
    FROM search_cids
  )
  AND r.ease > 0
  AND (
    r.type < 3
    OR r.factor != 0
  )
GROUP BY deck