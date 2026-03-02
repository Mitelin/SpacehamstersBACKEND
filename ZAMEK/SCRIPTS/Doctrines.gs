const Doctrines = (()=>{
  return {
    /* 
    * Finds Doctrine definition
    * - in: name, Doctrine name
    * - out: json definition of Doctrine - array of type, amount values
    */
    getDoctrine: function(name) {
      // Load doctrines from the sheet
      var lastCol = doctrineSheet.getLastColumn();
      if (lastCol <= 1) {
        SpreadsheetApp.getUi().alert('Chyba!', 'prázdný sheet doktrýn', SpreadsheetApp.getUi().ButtonSet.OK);
        return null;
      }
      var doctrines = doctrineSheet.getRange(2, 1, 61, lastCol).getValues();

      // Find the doctrine by name
      var col = 0;
      while (col < lastCol) {
//        console.log (doctrines[0][col]);
        if (doctrines[0][col] == name) break;
        col ++;
      }

      if (col >= lastCol - 1) {
        SpreadsheetApp.getUi().alert('Chyba!', 'Doktrýna nenalezena', SpreadsheetApp.getUi().ButtonSet.OK);
        return null;
      }

      // Find the Doctrine definition
      let types = [];

      for (let row = 1; row < 61; row++) {
        let item = doctrines[row][col];
        item = item.trim();
//        console.log(item);
        if (item) {
          types.push({"type": item, "amount": doctrines[row][col + 1], isBuy : (row > 40)?1:0})
        }
      }

      return types;  

    }
  }
})()


function testGetDoctrine() {
  console.log(Doctrines.getDoctrine('[DOC CFI Fleet]'));
}
