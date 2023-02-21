const express = require('express');
const app = express();
const db = require('./db.js');

app.use(db)
app.use(express.json())

app.get('/reviews/', (req, res) => {
  // params: product_id r, page d1, count d5, sort by
  var page = req.query.page || 0;
  var count = req.query.count || 5;
  var product = req.query.product_id || -1;
  var sort = req.query.sort || 'relevant';
  var returnObject = {
    "product": product.toString(),
    page,
    count,
    results: []
  }
  var monthInUnix = 2592000000;
  if (product === -1) {
    res.sendStatus(401);
  } else {
    req.psqlClient.query(`SELECT id, rating, summary, recommend, response, body, date, reviewer_name, helpfulness, photo
    FROM reviews
    WHERE product_id=${product}
    ${sort === 'newest' ? `ORDER BY date DESC LIMIT ${count};` : sort === 'helpfulness' ?`ORDER BY helpfulness DESC LIMIT ${count};` : `LIMIT ${count};`}`)
    .then(async (data) => {
      var relevantObjs = [];
      for (var i = 0; i < data.rows.length; i++) {
        var row = data.rows[i];
        if (row.photo === 'true' || row.photo === true) {
          var photos = await req.psqlClient.query(`SELECT photo_link FROM photos WHERE review_id=${row.id}`);
          row.photos = photos.rows
        } else {
          row.photos = [];
        }
        delete row.photo;
        row.review_id = row.id;
        delete row.id;
        if (sort === 'helpfulness' || sort === 'newest') {
          returnObject.results.push(row)
        } else if (sort === 'relevant') {
          row.relevance = new Date(new Date(row.date).getTime() + monthInUnix * row.helpfulness).getTime();
          relevantObjs.push(row)
        }
      }
      if (sort === 'relevant') {
        relevantObjs.sort((a, b) => parseInt(b.relevance) - parseInt(a.relevance));
        relevantObjs.forEach(obj => {delete obj.relevance; returnObject.results.push(obj)})
      }
      req.psqlClient.release()
      res.send(returnObject)
    })
    .catch(err => res.send(err));
  }

});

app.get('/reviews/meta', (req, res) => {
  var product = req.query.product_id || -1;
  var returnObj = {
    "product_id": product,
    "ratings": {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    },
    "recommended": {
      "false": 0,
      "true": 0,
    },
    "characteristics": {},
  }


  if (product === -1) {
    res.sendStatus(401);
  } else {
    // retrieve all the metadata besides the characteristic information
    req.psqlClient.query(`SELECT rating_one, rating_two, rating_three, rating_four, rating_five, recommend_false, recommend_true FROM metadata WHERE product_id=${product}`)
      .then(data => {
        returnObj.ratings[1] = row.rating_one.toString();
        returnObj.ratings[2] = row.rating_two.toString();
        returnObj.ratings[3] = row.rating_three.toString();
        returnObj.ratings[4] = row.rating_four.toString();
        returnObj.ratings[5] = row.rating_five.toString();
        returnObj.recommended.false = row.recommend_false.toString();
        returnObj.recommended.true = row.recommend_true.toString();
        // return information relevant to the characteristics
        return req.psqlClient.query(`SELECT id, name FROM characteristics WHERE product_id=${product}`)
      })
      .then((data) => {
        for (var rowIndex = 0; rowIndex < data.rows.length; rowIndex++){
          var row = data.rows[rowIndex];
          var max = data.rows.length - 1;
          // store ID from each result in the characteristics object
          returnObj.characteristics[row.name] = {
            id: row.id,
            value: 0,
            length: 0,
          }
          req.psqlClient.query(`SELECT COALESCE(SUM(value), 0), COUNT(*) FROM characteristic_reviews WHERE characteristic_id=${row.id}`).then(characteristic => {
            returnObj.characteristics[row.name].value = characteristic.rows.coalesce / characteristic.rows.count;
            if (isNaN(returnObj.characteristics[row.name].value)) {returnObj.characteristics[row.name].value = 0}
            if (rowIndex === data.rows.length - 1) {
              req.psqlClient.release()
              res.send(returnObj)
            }
          })
          .catch(err => {
            req.psqlClient.release();
            res.statusCode(500).send(err);
          })

        }

      })
      .catch(err => {req.psqlClient.release(); res.statusCode(500).send(err)});
  }
})

app.put('/reviews/:id/helpful', (req, res) => {
  req.psqlClient.query(`UPDATE reviews SET helpfulness = helpfulness + 1 WHERE id=${req.params.id}`)
    .then(data => {
      req.psqlClient.release();
      res.sendStatus(204);
    })
    .catch(err => {
      req.psqlClient.release();
      res.send(err);
    })
})

app.post('/reviews', (req, res) => {
  var newIndex;
  req.psqlClient.query(`SELECT MAX(id) FROM reviews;`)
    .then(data => {
      newIndex = data.rows[0].max + 1;
      var date = new Date();
      return req.psqlClient.query(`INSERT INTO reviews VALUES (${newIndex}, ${req.body.product_id}, ${req.body.rating}, '${date.toISOString()}', '${req.body.summary}', '${req.body.body}', false, ${req.body.recommend}, '${req.body.name}', '${req.body.email}', null, 0)`)
    })
    .then((data) => {
      console.log('INSERT SUCCESS STARTING char')
      return req.psqlClient.query(`SELECT MAX(id) FROM characteristic_reviews;`)
    })
    .then(async (data) => {
      var newId = data.rows[0].id;
      for (var key in req.body.characteristics) {
        newId++;
        await req.psqlClient.query(`INSERT INTO characteristic_reviews VALUES (${newId}, ${key}, ${newIndex}, ${req.body.characteristics[key]});`)
      }
    })
    .then(() => {
      // update meta
      console.log('INSERT INTO CHAR REVIEWS SUCCESS')
      var number = `${req.body.rating === 1 ? 'one' : req.body.rating === 2 ? 'two' : req.body.rating === 3 ? 'three' : req.body.rating === 4 ? 'four' : req.body.rating === 5 ? 'five' : res.status(401).send('Wrong rating sent')}`
      var bool = `${req.body.recommend}`
      return req.psqlClient.query(`UPDATE metadata SET rating_${number} = rating_${number} + 1, recommend_${bool} = recommend_${bool} + 1 WHERE product_id=${req.body.product_id}`)
    })
    .then(() => {
      console.log('UPDATE META SUCCESS')
      req.psqlClient.release()
      res.sendStatus(201);
    })

})

app.listen(3000, () => {
  console.log('listening on 3000')
});