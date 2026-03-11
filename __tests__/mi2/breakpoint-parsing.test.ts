import { parseMI, MINode } from '../../src/backend/mi_parse';

describe('MI3/MI4 Breakpoint Parsing', () => {
  describe('MI2 Format - Single Breakpoint', () => {
    test('should parse simple breakpoint response', () => {
      const mi2Response = '1^done,bkpt={number="1",type="breakpoint",disp="keep",enabled="y",addr="0x08000100",func="main",file="main.c",fullname="/path/to/main.c",line="10",thread-groups=["i1"],times="0",original-location="main.c:10"}';
      const parsed = parseMI(mi2Response);
      
      expect(parsed.resultRecords.resultClass).toBe('done');
      expect(parsed.result('bkpt.number')).toBe('1');
      expect(parsed.result('bkpt.type')).toBe('breakpoint');
      expect(parsed.result('bkpt.line')).toBe('10');
    });

    test('should extract breakpoint number from MI2 format', () => {
      const mi2Response = '2^done,bkpt={number="5",type="breakpoint",disp="keep",enabled="y",addr="0x08000200",func="setup",file="setup.c",line="42"}';
      const parsed = parseMI(mi2Response);
      
      const bkptNumber = parseInt(parsed.result('bkpt.number'));
      expect(bkptNumber).toBe(5);
      expect(isNaN(bkptNumber)).toBe(false);
    });
  });

  describe('MI3 Format - Multi-location Breakpoints', () => {
    test('should parse multi-location breakpoint with locations array', () => {
      // MI3 format for template functions or inline functions
      const mi3Response = '3^done,bkpt={number="2",type="breakpoint",disp="keep",enabled="y",addr="<MULTIPLE>",locations=[{number="2.1",enabled="y",addr="0x08000300",func="template<int>",file="template.cpp",line="20"},{number="2.2",enabled="y",addr="0x08000400",func="template<float>",file="template.cpp",line="20"}],times="0"}';
      const parsed = parseMI(mi3Response);
      
      expect(parsed.resultRecords.resultClass).toBe('done');
      expect(parsed.result('bkpt.number')).toBe('2');
      expect(parsed.result('bkpt.addr')).toBe('<MULTIPLE>');
      
      const locations = parsed.result('bkpt.locations');
      expect(locations).toBeDefined();
      expect(Array.isArray(locations)).toBe(true);
      expect(locations.length).toBe(2);
    });

    test('should extract first location number from multi-location breakpoint', () => {
      const mi3Response = '4^done,bkpt={number="3",type="breakpoint",locations=[{number="3.1",addr="0x08000500"},{number="3.2",addr="0x08000600"}]}';
      const parsed = parseMI(mi3Response);
      
      const locations = parsed.result('bkpt.locations');
      const firstLocationNumber = MINode.valueOf(locations[0], 'number');
      expect(firstLocationNumber).toBe('3.1');
    });

    test('should handle parent breakpoint number in multi-location format', () => {
      const mi3Response = '5^done,bkpt={number="7",type="breakpoint",addr="<MULTIPLE>",locations=[{number="7.1"},{number="7.2"}]}';
      const parsed = parseMI(mi3Response);
      
      const parentNumber = parseInt(parsed.result('bkpt.number'));
      expect(parentNumber).toBe(7);
      expect(isNaN(parentNumber)).toBe(false);
    });
  });

  describe('MI4 Format - Script Field as List', () => {
    test('should parse breakpoint with script field as list', () => {
      // MI4 format where script is a list instead of string
      const mi4Response = '6^done,bkpt={number="4",type="breakpoint",script=["print x","continue"],disp="keep",enabled="y",addr="0x08000700",func="debug_func",file="debug.c",line="30"}';
      const parsed = parseMI(mi4Response);
      
      expect(parsed.resultRecords.resultClass).toBe('done');
      expect(parsed.result('bkpt.number')).toBe('4');
      
      const script = parsed.result('bkpt.script');
      expect(script).toBeDefined();
      expect(Array.isArray(script)).toBe(true);
      expect(script.length).toBe(2);
      expect(script[0]).toBe('print x');
      expect(script[1]).toBe('continue');
    });

    test('should handle breakpoint without script field', () => {
      const mi4Response = '7^done,bkpt={number="8",type="breakpoint",disp="keep",enabled="y",addr="0x08000800"}';
      const parsed = parseMI(mi4Response);
      
      expect(parsed.result('bkpt.number')).toBe('8');
      expect(parsed.result('bkpt.script')).toBeUndefined();
    });
  });

  describe('Backward Compatibility', () => {
    test('should handle all MI versions consistently', () => {
      const responses = [
        '1^done,bkpt={number="1",addr="0x100"}', // MI2
        '2^done,bkpt={number="2",addr="<MULTIPLE>",locations=[{number="2.1"}]}', // MI3
        '3^done,bkpt={number="3",script=["cmd1"]}', // MI4
      ];

      responses.forEach((response, index) => {
        const parsed = parseMI(response);
        expect(parsed.resultRecords.resultClass).toBe('done');
        
        const bkptData = parsed.result('bkpt');
        expect(bkptData).toBeDefined();
        
        const number = parsed.result('bkpt.number');
        expect(number).toBe(String(index + 1));
      });
    });

    test('should gracefully handle missing breakpoint data', () => {
      const errorResponse = '10^error,msg="No symbol table is loaded."';
      const parsed = parseMI(errorResponse);
      
      expect(parsed.resultRecords.resultClass).toBe('error');
      expect(parsed.result('bkpt')).toBeUndefined();
      expect(parsed.result('msg')).toBe('No symbol table is loaded.');
    });
  });

  describe('Edge Cases', () => {
    test('should handle breakpoint with pending status', () => {
      const pendingResponse = '8^done,bkpt={number="9",type="breakpoint",disp="keep",enabled="y",addr="<PENDING>",pending="nonexistent.c:100"}';
      const parsed = parseMI(pendingResponse);
      
      expect(parsed.result('bkpt.number')).toBe('9');
      expect(parsed.result('bkpt.addr')).toBe('<PENDING>');
      expect(parsed.result('bkpt.pending')).toBe('nonexistent.c:100');
    });

    test('should handle conditional breakpoint', () => {
      const conditionalResponse = '9^done,bkpt={number="10",type="breakpoint",cond="x > 5",enabled="y",addr="0x08000900"}';
      const parsed = parseMI(conditionalResponse);
      
      expect(parsed.result('bkpt.number')).toBe('10');
      expect(parsed.result('bkpt.cond')).toBe('x > 5');
    });

    test('should handle breakpoint with ignore count', () => {
      const ignoreResponse = '10^done,bkpt={number="11",type="breakpoint",ignore="3",enabled="y",addr="0x08000A00"}';
      const parsed = parseMI(ignoreResponse);
      
      expect(parsed.result('bkpt.number')).toBe('11');
      expect(parsed.result('bkpt.ignore')).toBe('3');
    });

    test('should handle disabled breakpoint', () => {
      const disabledResponse = '11^done,bkpt={number="12",type="breakpoint",enabled="n",addr="0x08000B00"}';
      const parsed = parseMI(disabledResponse);
      
      expect(parsed.result('bkpt.number')).toBe('12');
      expect(parsed.result('bkpt.enabled')).toBe('n');
    });

    test('should handle temporary breakpoint', () => {
      const tempResponse = '12^done,bkpt={number="13",type="breakpoint",disp="del",enabled="y",addr="0x08000C00"}';
      const parsed = parseMI(tempResponse);
      
      expect(parsed.result('bkpt.number')).toBe('13');
      expect(parsed.result('bkpt.disp')).toBe('del');
    });
  });

  describe('MINode.valueOf Path Traversal', () => {
    test('should traverse nested structures', () => {
      const response = '1^done,bkpt={number="1",locations=[{number="1.1",addr="0x100"},{number="1.2",addr="0x200"}]}';
      const parsed = parseMI(response);
      
      const locations = parsed.result('bkpt.locations');
      const firstAddr = MINode.valueOf(locations[0], 'addr');
      const secondAddr = MINode.valueOf(locations[1], 'addr');
      
      expect(firstAddr).toBe('0x100');
      expect(secondAddr).toBe('0x200');
    });

    test('should handle array indexing in paths', () => {
      const response = '2^done,bkpt={locations=[{number="2.1"},{number="2.2"}]}';
      const parsed = parseMI(response);
      
      const locations = parsed.result('bkpt.locations');
      expect(locations[0]).toBeDefined();
      expect(locations[1]).toBeDefined();
      expect(MINode.valueOf(locations[0], 'number')).toBe('2.1');
    });

    test('should return undefined for non-existent paths', () => {
      const response = '3^done,bkpt={number="3"}';
      const parsed = parseMI(response);
      
      expect(parsed.result('bkpt.nonexistent')).toBeUndefined();
      expect(parsed.result('bkpt.locations')).toBeUndefined();
    });
  });

  describe('Real-world Scenarios', () => {
    test('should handle Arduino/PlatformIO breakpoint response', () => {
      const arduinoResponse = '1^done,bkpt={number="1",type="breakpoint",disp="keep",enabled="y",addr="0x000003e8",func="setup",file="sketch.ino",fullname="/home/user/project/sketch.ino",line="15",thread-groups=["i1"],times="0",original-location="sketch.ino:15"}';
      const parsed = parseMI(arduinoResponse);
      
      expect(parsed.result('bkpt.number')).toBe('1');
      expect(parsed.result('bkpt.func')).toBe('setup');
      expect(parsed.result('bkpt.file')).toBe('sketch.ino');
      expect(parsed.result('bkpt.line')).toBe('15');
    });

    test('should handle ESP32 multi-core breakpoint', () => {
      const esp32Response = '2^done,bkpt={number="2",type="breakpoint",disp="keep",enabled="y",addr="0x400d1234",func="app_main",file="main.c",line="50",thread-groups=["i1","i2"],times="0"}';
      const parsed = parseMI(esp32Response);
      
      expect(parsed.result('bkpt.number')).toBe('2');
      expect(parsed.result('bkpt.func')).toBe('app_main');
      
      const threadGroups = parsed.result('bkpt.thread-groups');
      expect(Array.isArray(threadGroups)).toBe(true);
      expect(threadGroups.length).toBe(2);
    });

    test('should handle STM32 breakpoint with HAL function', () => {
      const stm32Response = '3^done,bkpt={number="3",type="breakpoint",disp="keep",enabled="y",addr="0x08001000",func="HAL_GPIO_WritePin",file="stm32f4xx_hal_gpio.c",line="200"}';
      const parsed = parseMI(stm32Response);
      
      expect(parsed.result('bkpt.number')).toBe('3');
      expect(parsed.result('bkpt.func')).toBe('HAL_GPIO_WritePin');
      expect(parsed.result('bkpt.addr')).toBe('0x08001000');
    });
  });
});
