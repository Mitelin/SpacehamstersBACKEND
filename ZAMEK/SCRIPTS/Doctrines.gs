const Doctrines = (() => {
  const normalizeDoctrineName_ = (name) => {
    return String(name == null ? '' : name)
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const fail_ = (message, options) => {
    if (!(options && options.silent)) {
      SpreadsheetApp.getUi().alert('Chyba!', message, SpreadsheetApp.getUi().ButtonSet.OK);
    }
    return null;
  };

  return {
    /*
     * Finds Doctrine definition
     * - in: name, Doctrine name
     * - out: json definition of Doctrine - array of type, amount values
     */
    getDoctrine: function(name, options) {
      const doctrineName = normalizeDoctrineName_(name);
      if (!doctrineName) return fail_('Doktryna nenalezena', options);

      if (!doctrineSheet) return fail_('Sheet DOKTRYNY DATASHEET nenalezen', options);

      const lastCol = doctrineSheet.getLastColumn();
      if (lastCol <= 1) return fail_('Prazdny sheet doktryn', options);

      const doctrines = doctrineSheet.getRange(2, 1, 61, lastCol).getValues();

      let col = -1;
      for (let i = 0; i < lastCol; i++) {
        if (normalizeDoctrineName_(doctrines[0][i]) === doctrineName) {
          col = i;
          break;
        }
      }

      if (col < 0 || col >= lastCol - 1) {
        return fail_('Doktryna nenalezena: ' + doctrineName, options);
      }

      const types = [];
      for (let row = 1; row < 61; row++) {
        const item = String(doctrines[row][col] == null ? '' : doctrines[row][col]).trim();
        if (!item) continue;

        types.push({
          type: item,
          amount: doctrines[row][col + 1],
          isBuy: (row > 40) ? 1 : 0,
        });
      }

      return types;
    }
  };
})();

function testGetDoctrine() {
  console.log(Doctrines.getDoctrine('[DOC CFI Fleet]'));
}
