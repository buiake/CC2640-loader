///////////////////////////////////////////////////////////////////////////////////
// program arguments
var bin_filename = "" ;
var com_port = "" ;
var com_baud = 19200 ;

if (process.argv.length < 4)
{
  console.log ('Use: >node loader.js binary_filename comport_nbr [baud]') ;
  process.exit (-1) ;
}

bin_filename = process.argv[2] ;
com_port     = process.argv[3] ;

if (process.argv.length == 5)
{
  com_baud = +process.argv[4] ;
}
///////////////////////////////////////////////////////////////////////////////////
// serial port
var SerialPort = require("serialport") ;
var serialport = new SerialPort
(
  'COM'+com_port,
  {
    baudRate: com_baud,
    dataBits: 8,
    parity  : 'none',
    stopBits: 1,
  }
);

serialport.on('open', function()
{
  console.log('Serial Port Opend COM'+com_port);

  serialport.set ({rts:false, dtr:false}) ;

  serialport.on('data', serialport_rxdata) ;

  timer = setTimeout(loader_task,200) ;

});

function serialport_txdata (buf)
{
//  var hexbuffer = new Buffer (data, 'hex') ;

//  console.log ('--> tx '+hexbuffer) ;
  buf.writeUInt8(checksum(buf), 1) ;

  serialport.write(buf, function () {
   serialport.drain();
  });
}

var rx_buffer = new Buffer (256, 'hex') ;
var rx_count  = 0 ;
function serialport_rxdata (rxbuffer)
{
//  rxbuffer += String.fromCharCode.apply(null, data)  ;
  var i = 0 ;

  console.log (rxbuffer) ;

  while ((i < rxbuffer.length) && (rxbuffer.readUInt8(i) == 0x00)) i++ ;

  const rxbuf = rxbuffer.slice (i) ;
//  console.log ('offs ' + i ) ;
//  console.log (rxbuf) ;

  if (rxbuf.length > 0)
  {
    switch (loader_rx_state)
    {
      case 0:
           break ;

      case 1:
           console.log ("<-- rx ACK reply") ;

           if (rxbuf.readUInt8(0) == 0xCC)
           {
             loader_rx_state = 0 ;
             loader_task() ;
           }
           break ;

      case 2:
           rxbuf.copy (rx_buffer, rx_count) ;
           rx_count += rxbuf.length ;

           if (rx_count < 1+3) break ; // 0xCC + len + chk + status

           // check the first 0xCC!!!!!!!!!

           console.log ("<-- rx status reply") ;

           loader_rx_state = 0 ;

           flash_cmd_status = rx_buffer.readUInt8(3) ;

           if (flash_cmd_status != 0x40)
           {
             console.log ('--------------- command error !!!') ;
             process.exit (-1) ;
           }

           rx_count = 0 ;

           loader_task() ;
           break ;

    }
  }
}

function tx_sync()
{
  var buf = new Buffer (2, 'hex') ;

  buf.writeUInt8(0x55,0) ;
  buf.writeUInt8(0x55,1) ;

  serialport.write(buf, function () {
   serialport.drain();
  });
}

function tx_ack()
{
  var buf = new Buffer (2, 'hex') ;

  buf.writeUInt8(0x00,0) ;
  buf.writeUInt8(0xCC,1) ;

  serialport.write(buf, function () {
   serialport.drain();
  });
}
///////////////////////////////////////////////////////////////////////////////////
// file
var fs = require('fs');

var file_buffer     = new Buffer(256) ; // file chunk data
var file_buffer_len = 0 ; // effective read length
var file_offs       = 0 ; // offset while read

function file_read(offs)
{
  file_buffer ;

//  fs.open('central.bin', 'r', function(err, fd) {
  fs.open(bin_filename, 'r', function(err, fd) {
     if (err) {
      // file not found or error when opening
          console.error(err);
          process.exit(-1) ;
     }
     else
     {
       // read adta from file
       fs.read(fd, file_buffer, 0, 240, offs, function(err, bytes){
         if (err){
            console.log(err);
         }
         else
         {
           // the effective read data
           file_buffer_len = bytes ;

//           console.log ('file data read ok' + bytes) ;
//           console.log (file_buffer.toString('hex')) ;

            // Close the opened file.
            fs.close(fd, function(err){
               if (err){
                 console.log(err);
               }
               loader_task() ;
            }) ;
         }
      }) ;
    }
  }) ;
}


///////////////////////////////////////////////////////////////////////////////////
// CC2640 flash

var flash_cmd_status = 0x40 ;
var flash_address    = 0;

// checksum sum all data buffer bytes (data buffer offs from 2 and start with command)
function checksum(msg)
{
  var sum = 0 ;
  var len = msg.readUInt8(0) ; // read msg length

  // skip len and checksum bytes
  for (var i=2 ; i<msg.length ; i++)
  {
    sum += msg.readUInt8(i) ;
  }
  return (sum & 0xFF) ;
}


function flash_command_ping()
{
  var msg_data = new Buffer (3, 'hex') ;

  msg_data.writeUInt8(1+1+1,0) ;
  msg_data.writeUInt8(0x00 ,1) ;
  msg_data.writeUInt8(0x20 ,2) ;

  serialport_txdata (msg_data) ;
}

function flash_command_get_status()
{
  var msg_data = new Buffer (3, 'hex') ;

  msg_data.writeUInt8(1+1+1,0) ;
  msg_data.writeUInt8(0x00 ,1) ;
  msg_data.writeUInt8(0x23 ,2) ;

  serialport_txdata (msg_data) ;
}


function flash_command_get_chipID()
{
  var msg_data = new Buffer (3, 'hex') ;

  msg_data.writeUInt8(1+1+1,0) ;
  msg_data.writeUInt8(0x00 ,1) ;
  msg_data.writeUInt8(0x28 ,2) ;

  serialport_txdata (msg_data) ;
}


function flash_sector_erase (address)
{
  var msg_data = new Buffer (3+4, 'hex') ;

  msg_data.writeUInt8(1+1+1+4,0) ;
  msg_data.writeUInt8(0x00   ,1) ;
  msg_data.writeUInt8(0x26   ,2) ;
  msg_data.writeUInt8(((address & 0xFF000000) >> 24), 3) ;
  msg_data.writeUInt8(((address & 0x00FF0000) >> 16), 4) ;
  msg_data.writeUInt8(((address & 0x0000FF00) >>  8), 5) ;
  msg_data.writeUInt8(((address & 0x000000FF)      ), 6) ;

  serialport_txdata (msg_data) ;
}


function flash_command_download (from_address, data_len)
{
  var msg_data = new Buffer (3+4+4, 'hex') ;

  msg_data.writeUInt8(1+1+1+4+4,0) ;
  msg_data.writeUInt8(0x00     ,1) ;
  msg_data.writeUInt8(0x21     ,2) ;
  msg_data.writeUInt8(((from_address & 0xFF000000) >> 24), 3) ;
  msg_data.writeUInt8(((from_address & 0x00FF0000) >> 16), 4) ;
  msg_data.writeUInt8(((from_address & 0x0000FF00) >>  8), 5) ;
  msg_data.writeUInt8(((from_address & 0x000000FF)      ), 6) ;
  msg_data.writeUInt8(((data_len     & 0xFF000000) >> 24), 7) ;
  msg_data.writeUInt8(((data_len     & 0x00FF0000) >> 16), 8) ;
  msg_data.writeUInt8(((data_len     & 0x0000FF00) >>  8), 9) ;
  msg_data.writeUInt8(((data_len     & 0x000000FF)      ),10) ;

  serialport_txdata (msg_data) ;
}

function flash_command_send_data  (prg_data)
{
  var tmp_buffer = new Buffer (3, 'hex') ;

  tmp_buffer.writeUInt8(1+1+1,0) ;
  tmp_buffer.writeUInt8(0x00 ,1) ;
  tmp_buffer.writeUInt8(0x24 ,2) ;

  var buff_len = tmp_buffer.length + file_buffer_len;
  var msg_data = Buffer.concat ([tmp_buffer, prg_data], buff_len) ;

  msg_data.writeUInt8(buff_len, 0) ;

  serialport_txdata (msg_data) ;
}
///////////////////////////////////////////////////////////////////////////////////
// programming task

var timer ;
var loader_task_state = 0 ;
var loader_rx_state = 0 ;

function loader_task()
{
  switch (loader_task_state)
  {
    case 0:
         // pull dn reset and boot lines
         console.log ("reset device") ;
         serialport.set ({rts:true, dtr:true}) ;
         timer = setTimeout(loader_task,500) ;

         loader_task_state++ ;
         break ;

    case 1:
         // release reset line with boot line down enter boot mode
         console.log ("reset line off") ;
         serialport.set ({rts:true, dtr:false}) ;
         timer = setTimeout(loader_task,500) ;

         loader_task_state++ ;
         break ;

    case 2:
         // release also boot line
         console.log ("boot line off") ;
         serialport.set ({rts:false, dtr:false}) ;
         timer = setTimeout(loader_task,500) ;

         loader_task_state++ ;
         break ;

    case 3:
         // sync the baud rate with 0x55 0x55 and wait 0xCC reply
         console.log ("--> send sinc msg") ;

         tx_sync() ;

         //timer = setTimeout(loader_task,500) ;

         loader_rx_state = 1 ;
         loader_task_state++ ;
         break ;

    case 4:
         // be sure all is ok check device connection with ping (wait rx 0xCC)
         console.log ("--> send ping msg") ;

         loader_rx_state = 1 ;
         loader_task_state++ ;

         flash_command_ping() ;

         //timer = setTimeout(loader_task,500) ;

         flash_address = 0 ;

         break ;

    case 5:
         //break;
         // ok before prog flash must be erased work with 4K blocks
         console.log ("--> erase 4K flash block " + flash_address.toString(16)) ;

         loader_rx_state = 1 ;

         flash_sector_erase (flash_address) ;

         flash_address += 0x0001000 ;

         if (flash_address == 0x0020000)
         {
           //process.exit(0) ;
/*
           flash_address = 0 ;
           flash_command_download (0x00000, 0x20000) ;
*/
           loader_task_state++ ;
         }

         //timer = setTimeout(loader_task,500) ;
         break ;

    case 6:
         // flash erased ok! now send a DOWNLOAD(0x21) command
         // set prg start address and prg area size  z
         console.log ("Start flash programming") ;

         flash_address = 0 ;

         loader_rx_state = 1 ;
         loader_task_state++ ;

         flash_command_download (0x00000, 0x20000) ;

//         timer = setTimeout(loader_task,500) ;
         break ;

    case 7:
         // be careful! read command status before start
         // must return 0x40 otherwise stop all and exit with code -1
         console.log ("command get status") ;

         loader_rx_state = 2 ;
         loader_task_state++ ;

         flash_command_get_status() ;

//         timer = setTimeout(loader_task,500) ;

         break ;


    case 8:
         // start read file process when read ok restart loader task
         tx_ack() ;

         if (flash_address >= 0x0020000)
         {
           loader_task_state = 10 ;
           timer = setTimeout(loader_task,1500) ;

           break ;
         }

         console.log ("Read bin file") ;

         loader_task_state++ ;

         file_read(file_offs) ;
         break ;

    case 9:
         // send data block and wait ack before send next block
         // check also status before send another block
         console.log ('--> prog flash block addr ' + flash_address + ' offs ' + file_offs) ;

         loader_rx_state    = 1 ;
         loader_task_state -= 2 ;

         flash_command_send_data(file_buffer) ;

         flash_address += file_buffer_len ;
         file_offs     += file_buffer_len ;

        //timer = setTimeout(loader_task,500) ;
         break ;

    case 10:
         console.log ("end programming") ;
         process.exit(0) ;
         break ;

  }
}
///////////////////////////////////////////////////////////////////////////////////
// eof
