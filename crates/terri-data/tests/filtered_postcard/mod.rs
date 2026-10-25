//! A postcard-compatible serializer that can leave struct fields out and
//! rewrite whole-number fields, for proving that a fixture changed only by
//! the fields a change appended.
//!
//! Postcard writes a struct as its fields in order with no names, so leaving
//! a field out of the serialization removes exactly that field's bytes,
//! wherever the struct is nested. Every primitive is encoded by postcard
//! itself, so with no rule the output must equal `postcard::to_allocvec`;
//! the fixture test asserts that before trusting a filtered encoding.
use serde::ser::{self, Serialize};

/// What to do with a struct field: keep it, leave it out, or replace a
/// `u32` by a function of it.
pub enum Rule {
    Keep,
    Omit,
    MapU32(fn(u32) -> u32),
}

/// Encodes `value` as postcard would, applying `rule(struct, field)` to every
/// struct field.
pub fn to_vec<T: Serialize + ?Sized>(
    value: &T,
    rule: &dyn Fn(&'static str, &'static str) -> Rule,
) -> Vec<u8> {
    let mut out = Vec::new();
    value
        .serialize(&mut Filtered {
            out: &mut out,
            rule,
            structs: Vec::new(),
        })
        .expect("the filtered encoding cannot fail");
    out
}

fn postcard<T: Serialize + ?Sized>(value: &T) -> Vec<u8> {
    postcard::to_allocvec(value).expect("postcard encodes every primitive")
}

struct Filtered<'a> {
    out: &'a mut Vec<u8>,
    rule: &'a dyn Fn(&'static str, &'static str) -> Rule,
    /// The names of the structs being written, innermost last, so a rule
    /// sees which struct a field belongs to.
    structs: Vec<&'static str>,
}

#[derive(Debug)]
pub struct Error(String);
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for Error {}
impl ser::Error for Error {
    fn custom<M: std::fmt::Display>(message: M) -> Self {
        Self(message.to_string())
    }
}

impl Filtered<'_> {
    fn raw<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.out.extend(postcard(value));
        Ok(())
    }
    fn length(&mut self, len: Option<usize>) -> Result<(), Error> {
        let len = len.ok_or_else(|| Error("postcard needs every length".into()))?;
        self.raw(&len)
    }
    fn variant(&mut self, index: u32) -> Result<(), Error> {
        self.raw(&index)
    }
}

macro_rules! primitive {
    ($($method:ident: $ty:ty),* $(,)?) => {
        $(fn $method(self, value: $ty) -> Result<(), Error> {
            self.raw(&value)
        })*
    };
}

impl<'b> ser::Serializer for &'b mut Filtered<'_> {
    type Ok = ();
    type Error = Error;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;

    primitive!(
        serialize_bool: bool,
        serialize_i8: i8,
        serialize_i16: i16,
        serialize_i32: i32,
        serialize_i64: i64,
        serialize_i128: i128,
        serialize_u8: u8,
        serialize_u16: u16,
        serialize_u32: u32,
        serialize_u64: u64,
        serialize_u128: u128,
        serialize_f32: f32,
        serialize_f64: f64,
        serialize_char: char,
    );
    fn serialize_str(self, value: &str) -> Result<(), Error> {
        self.raw(value)
    }
    fn serialize_bytes(self, value: &[u8]) -> Result<(), Error> {
        self.raw(&serde_bytes_like(value))
    }
    fn serialize_none(self) -> Result<(), Error> {
        self.raw(&Option::<()>::None)
    }
    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<(), Error> {
        self.raw(&true)?;
        value.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), Error> {
        Ok(())
    }
    fn serialize_unit_struct(self, _: &'static str) -> Result<(), Error> {
        Ok(())
    }
    fn serialize_unit_variant(
        self,
        _: &'static str,
        index: u32,
        _: &'static str,
    ) -> Result<(), Error> {
        self.variant(index)
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        value.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        index: u32,
        _: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.variant(index)?;
        value.serialize(self)
    }
    fn serialize_seq(self, len: Option<usize>) -> Result<Self, Error> {
        self.length(len)?;
        Ok(self)
    }
    fn serialize_tuple(self, _: usize) -> Result<Self, Error> {
        Ok(self)
    }
    fn serialize_tuple_struct(self, _: &'static str, _: usize) -> Result<Self, Error> {
        Ok(self)
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        index: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, Error> {
        self.variant(index)?;
        Ok(self)
    }
    fn serialize_map(self, len: Option<usize>) -> Result<Self, Error> {
        self.length(len)?;
        Ok(self)
    }
    fn serialize_struct(self, name: &'static str, _: usize) -> Result<Self, Error> {
        self.structs.push(name);
        Ok(self)
    }
    fn serialize_struct_variant(
        self,
        name: &'static str,
        index: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, Error> {
        self.variant(index)?;
        self.structs.push(name);
        Ok(self)
    }
}

/// Postcard writes a byte slice as its length and its bytes, as it writes a
/// `Vec<u8>` through `serialize_bytes`; a slice of `u8` elements would go
/// through `serialize_seq` with the same bytes, so either form is exact.
fn serde_bytes_like(value: &[u8]) -> Vec<u8> {
    value.to_vec()
}

macro_rules! elements {
    ($trait:ident, $method:ident) => {
        impl ser::$trait for &mut Filtered<'_> {
            type Ok = ();
            type Error = Error;
            fn $method<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
                value.serialize(&mut **self)
            }
            fn end(self) -> Result<(), Error> {
                Ok(())
            }
        }
    };
}
elements!(SerializeSeq, serialize_element);
elements!(SerializeTuple, serialize_element);
elements!(SerializeTupleStruct, serialize_field);
elements!(SerializeTupleVariant, serialize_field);

impl ser::SerializeMap for &mut Filtered<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Error> {
        key.serialize(&mut **self)
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        value.serialize(&mut **self)
    }
    fn end(self) -> Result<(), Error> {
        Ok(())
    }
}

/// Applies the rule for `key` of the innermost struct being written.
fn field<T: Serialize + ?Sized>(
    filtered: &mut Filtered<'_>,
    key: &'static str,
    value: &T,
) -> Result<(), Error> {
    let owner = filtered.structs.last().copied().unwrap_or("");
    match (filtered.rule)(owner, key) {
        Rule::Keep => value.serialize(&mut *filtered),
        Rule::Omit => Ok(()),
        Rule::MapU32(map) => {
            let bytes = postcard(value);
            let number: u32 = postcard::from_bytes(&bytes)
                .map_err(|_| Error(format!("field '{key}' is not a u32")))?;
            filtered.raw(&map(number))
        }
    }
}

impl ser::SerializeStruct for &mut Filtered<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        field(self, key, value)
    }
    fn end(self) -> Result<(), Error> {
        self.structs.pop();
        Ok(())
    }
}

impl ser::SerializeStructVariant for &mut Filtered<'_> {
    type Ok = ();
    type Error = Error;
    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        field(self, key, value)
    }
    fn end(self) -> Result<(), Error> {
        self.structs.pop();
        Ok(())
    }
}
