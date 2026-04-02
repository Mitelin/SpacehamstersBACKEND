CREATE TABLE IF NOT EXISTS corpAssets (
    itemID BIGINT NOT NULL PRIMARY KEY,
    typeID BIGINT NOT NULL,
    locationType varchar(100),
    locationID BIGINT,
    locationFlag varchar(100),
    quantity BIGINT,
    isSingleton tinyint(1),
    isBlueprintCopy tinyint(1)
);

CREATE TABLE IF NOT EXISTS corpAssetsTemp (
    itemID BIGINT NOT NULL PRIMARY KEY,
    typeID BIGINT NOT NULL,
    locationType varchar(100),
    locationID BIGINT,
    locationFlag varchar(100),
    quantity BIGINT,
    isSingleton tinyint(1),
    isBlueprintCopy tinyint(1)
);

CREATE TABLE IF NOT EXISTS corpAssetsIDs (itemID BIGINT NOT NULL PRIMARY KEY) ENGINE = MEMORY;

CREATE TABLE IF NOT EXISTS corpAssetsNames (
    itemID BIGINT NOT NULL PRIMARY KEY,
    name VARCHAR(1000)
);

CREATE TABLE IF NOT EXISTS corpNames (
    ID BIGINT NOT NULL PRIMARY KEY,
    name VARCHAR(1000),
    category VARCHAR (100)
);

CREATE TABLE IF NOT EXISTS corpHangars (locationFlag varchar(100) NOT NULL PRIMARY KEY, name VARCHAR(100));
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG1', 'Research')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG2', 'Industry skladka')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG3', 'PVP')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG4', 'Exploration')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG5', 'Ore')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG6', 'Produkty')
    ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO corpHangars (locationFlag, name) VALUES ('CorpSAG7', 'Vykupy')
    ON DUPLICATE KEY UPDATE name=VALUES(name);

CREATE TABLE IF NOT EXISTS corpJobs (
    jobID INT  NOT NULL PRIMARY KEY,
    activityID INT,
    blueprintID BIGINT,
    blueprintLocationID BIGINT,
    blueprintTypeID INT,
    completedCharacterID INT,
    completedDate DATETIME,
    cost DECIMAL (15,2),
    duration INT,
    endDate DATETIME,
    facilityID BIGINT,
    installerID INT,
    licensedRuns INT,
    outputLocationID BIGINT,
    pauseDate DATETIME,
    probability INT,
    productTypeID INT,
    runs INT,
    startDate DATETIME,
    stationID BIGINT,
    status VARCHAR(20),
    successfulRuns INT)
;
CREATE TABLE IF NOT EXISTS corpWalletJournal (
    id BIGINT NOT NULL PRIMARY KEY,
    amount DECIMAL (15,2),
    balance DECIMAL (15,2),
    contextID BIGINT,
    contextIDType VARCHAR(100),
    date DATETIME,
    description VARCHAR(1000),
    firstPartyID INT,
    reason VARCHAR(200),
    refType VARCHAR(100),
    secondPartyId INT,
    tax DECIMAL (15,2),
    taxReceiverID INT)
;

-- Snapshot tables for restoring historical monthly reports when raw tables
-- (corpJobs/corpWalletJournal) were not migrated.
CREATE TABLE IF NOT EXISTS corpJobsReportMonthly (
    year INT NOT NULL,
    month INT NOT NULL,
    installerID INT NOT NULL,
    manufacturing INT,
    researchTE INT,
    researchME INT,
    copying INT,
    invention INT,
    reaction INT,
    PRIMARY KEY (year, month, installerID)
);

CREATE TABLE IF NOT EXISTS corpWalletJournalReportMonthly (
    wallet INT NOT NULL,
    year INT NOT NULL,
    month INT NOT NULL,
    refType VARCHAR(100) NOT NULL,
    secondPartyId INT NOT NULL,
    amount DECIMAL (15,2),
    PRIMARY KEY (wallet, year, month, refType, secondPartyId)
);

ALTER TABLE corpWalletJournal MODIFY contextIDType VARCHAR(100);

CREATE TABLE IF NOT EXISTS corpWalletTransactions (
    transactionID BIGINT NOT NULL PRIMARY KEY,
    wallet INT,
    clientID INT,
    date DATETIME,
    isBuy TINYINT(1),
    journalRefID BIGINT,
    locationID BIGINT,
    quantity INT,
    typeID INT,
    unitPrice DECIMAL (15,2))
;

CREATE TABLE IF NOT EXISTS corpUserInfo (
    userID INT NOT NULL PRIMARY KEY,
    date DATETIME,
    accessToken VARCHAR(2000),
    refreshToken VARCHAR(200),
    expiresIn INT)
;
